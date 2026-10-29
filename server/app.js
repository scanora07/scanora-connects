"use strict";

const path = require("path");
const express = require("express");
const { createBatch, listBatches, getBatch } = require("./slugs");
const { buildCardsZip } = require("./zip");
const { createGiftRouter, deleteExpired } = require("./gifts");
const { rateLimit } = require("./ratelimit");
const auth = require("./auth");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Builds the whole web app. Everything it needs is passed in, so the tests can run it
// against a throwaway database with their own settings.
//   config: { isProd, baseUrl, maxBatch, giftDays, cronSecret }
function createApp({ db, config, limits = {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render sits behind a proxy

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN", // other websites cannot embed our pages (clickjacking)
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (config.isProd) res.set("Strict-Transport-Security", "max-age=15552000");
    if (/^\/(admin|api\/admin|g\/|greet)/.test(req.path)) res.set("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // Keep-alive endpoint for the free scheduler. It deliberately does not touch the database.
  app.get("/healthz", (req, res) => res.type("text").send("ok"));

  // ---------------- Admin API ----------------
  const admin = express.Router();
  admin.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  admin.use(express.json({ limit: "2kb" }));

  admin.post("/login", auth.sameOrigin, auth.login);
  admin.post("/logout", auth.sameOrigin, auth.logout);
  admin.get("/me", (req, res) => (auth.isSignedIn(req) ? res.json({ ok: true }) : res.status(401).json({ error: "Please sign in." })));

  admin.use(auth.requireAuth);

  admin.get("/config", (req, res) => {
    res.json({
      maxBatch: config.maxBatch,
      baseUrl: config.baseUrl,
      exampleUrl: config.baseUrl + "/g/xxxxxxxxxx",
      giftDays: config.giftDays,
      // The link to paste into the scheduler (only shown here, after signing in)
      cleanupUrl: config.cronSecret ? config.baseUrl + "/api/cron/cleanup?key=" + encodeURIComponent(config.cronSecret) : null,
    });
  });

  admin.get("/batches", async (req, res) => {
    const rows = await listBatches(db);
    res.json(rows.map((b) => ({ id: b.id, label: b.label, count: b.count, createdAt: b.created_at })));
  });

  async function sendZip(req, res, batch, slugs) {
    let aborted = false;
    res.on("close", () => { if (!res.writableFinished) aborted = true; });
    const zip = await buildCardsZip(slugs, config.baseUrl, { isAborted: () => aborted });
    if (!zip) return;
    res.status(200).set({
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="qr-batch-' + batch.id + "-" + slugs.length + '.zip"',
      "Content-Length": String(zip.length),
      "X-Batch-Id": String(batch.id),
    });
    res.end(zip);
  }

  // Create a new batch of empty cards, then send the ZIP of their QR codes
  admin.post("/batches", auth.sameOrigin, async (req, res) => {
    const body = req.body || {};
    const count = body.count;
    if (!Number.isInteger(count) || count < 1 || count > config.maxBatch) {
      return res.status(400).json({ error: "Enter a whole number from 1 to " + config.maxBatch + "." });
    }
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
    const { batch, slugs } = await createBatch(db, { count, label });
    await sendZip(req, res, batch, slugs);
  });

  // Download the ZIP of an existing batch again. It is rebuilt from the links the batch saved,
  // so it is the same set of QR codes even after some of its gifts have expired.
  admin.get("/batches/:id/zip", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Bad batch number." });
    const found = await getBatch(db, id);
    if (!found) return res.status(404).json({ error: "Batch not found." });
    await sendZip(req, res, found.batch, found.slugs);
  });

  app.use("/api/admin", admin);

  // ---------------- Gift pages (public) ----------------
  app.use("/api", createGiftRouter(db, { giftDays: config.giftDays, limits }));

  // ---------------- Cleanup link (for the free scheduler, e.g. cron-job.org) ----------------
  // Opening  /api/cron/cleanup?key=<CRON_SECRET>  deletes every gift whose time is up.
  // It only ever removes rows that are already expired, so running it often (or by accident) is harmless.
  // The key can also be sent as an  Authorization: Bearer <key>  header.
  const cleanupLimit = rateLimit({ windowMs: 60000, max: limits.cleanup || 10 });
  const cleanup = async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!config.cronSecret) return res.status(404).json({ error: "Not found." });
    const bearer = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    const given = typeof req.query.key === "string" ? req.query.key : bearer ? bearer[1] : "";
    if (!given || !auth.safeEqual(given, config.cronSecret)) return res.status(401).json({ error: "Unauthorized." });
    res.json({ ok: true, deleted: await deleteExpired(db) });
  };
  app.route("/api/cron/cleanup").get(cleanupLimit, cleanup).post(cleanupLimit, cleanup);

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  // ---------------- Website ----------------
  app.get("/g/:slug", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
  // extensions: "/greet" opens greet.html. Fonts never change under the same name, so browsers keep them for a year.
  app.use(express.static(PUBLIC_DIR, {
    maxAge: config.isProd ? "1h" : 0,
    extensions: ["html"],
    setHeaders(res, file) {
      if (file.endsWith(".woff2")) res.set("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));
  app.use((req, res) => res.status(404).type("text").send("Not found"));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return res.destroy();
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Something went wrong on the server." : "Bad request." });
  });

  return app;
}

module.exports = { createApp };
