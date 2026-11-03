"use strict";

const path = require("path");
const express = require("express");
const { createCards, discardCards } = require("./slugs");
const { buildPdf, previewSvg, artProblem } = require("./sheet");
const { PER_SHEET } = require("./layout");
const { createGiftRouter, deleteExpired, SLUG } = require("./gifts");
const { rateLimit } = require("./ratelimit");
const { createAssets } = require("./assets");
const auth = require("./auth");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Builds the whole web app. Everything it needs is passed in, so the tests can run it
// against a throwaway database with their own settings.
//   config: { isProd, baseUrl, maxSheets, giftDays, cronSecret }
function createApp({ db, config, limits = {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render sits behind a proxy

  // The silver cards all open the homepage gift, so their QR code is just the site's address
  const silverUrl = () => config.baseUrl + "/";

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN", // other websites cannot embed our pages (clickjacking)
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (config.isProd) res.set("Strict-Transport-Security", "max-age=15552000");
    if (/^\/(admin|api\/admin|g\/)/.test(req.path)) res.set("X-Robots-Tag", "noindex, nofollow");
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
      maxSheets: config.maxSheets,
      perSheet: PER_SHEET,
      silverUrl: silverUrl(),
      goldExample: config.baseUrl + "/g/xxxxxxxxxx",
      giftDays: config.giftDays,
      // null when the card picture is in place and usable, otherwise what is wrong with it
      artProblems: { silver: artProblem("silver"), gold: artProblem("gold") },
      // The link to paste into the scheduler (only shown here, after signing in)
      cleanupUrl: config.cronSecret ? config.baseUrl + "/api/cron/cleanup?key=" + encodeURIComponent(config.cronSecret) : null,
    });
  });

  // A picture of one finished card of each kind, for the admin page
  admin.get("/preview/:edition", (req, res) => {
    const edition = req.params.edition.replace(/\.svg$/, "");
    if (edition !== "silver" && edition !== "gold") return res.status(404).json({ error: "Not found." });
    const problem = artProblem(edition);
    if (problem) return res.status(404).json({ error: problem });
    res.type("image/svg+xml").send(previewSvg(edition, edition === "silver" ? silverUrl() : config.baseUrl + "/g/xxxxxxxxxx"));
  });

  function sendPdf(res, pdf, fileName) {
    res.status(200).set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + fileName + '"',
      "Content-Length": String(pdf.length),
    });
    res.end(pdf);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const closedEarly = (res) => { let gone = false; res.on("close", () => { if (!res.writableFinished) gone = true; }); return () => gone; };

  // Silver: every card carries the same QR code (the homepage), so nothing is stored. One sheet,
  // and the shop prints as many copies as they need.
  admin.get("/sheets/silver", async (req, res) => {
    const problem = artProblem("silver");
    if (problem) return res.status(409).json({ error: problem });
    const pdf = await buildPdf("silver", [Array(PER_SHEET).fill(silverUrl())], { title: "Silver sheet", isAborted: closedEarly(res) });
    if (pdf) sendPdf(res, pdf, "silver-sheet.pdf");
  });

  // Gold: every card has its own QR code and its own empty row in the database. Each press of the
  // button makes brand-new cards, so a sheet can be printed once and never repeated by accident.
  let makingGold = false;
  admin.post("/sheets/gold", auth.sameOrigin, async (req, res) => {
    const sheets = (req.body || {}).sheets;
    if (!Number.isInteger(sheets) || sheets < 1 || sheets > config.maxSheets) {
      return res.status(400).json({ error: "Enter a whole number of sheets from 1 to " + config.maxSheets + "." });
    }
    // Checked before any card is created, so a missing or unusable picture never leaves cards behind
    const problem = artProblem("gold");
    if (problem) return res.status(409).json({ error: problem });
    if (makingGold) return res.status(429).json({ error: "Another gold download is still being prepared. Please wait a moment." });
    makingGold = true;
    const aborted = closedEarly(res); // watch from the very start, so a page closed early is never missed
    let slugs = [];
    try {
      slugs = await createCards(db, sheets * PER_SHEET);
      const pages = [];
      for (let i = 0; i < sheets; i++) pages.push(slugs.slice(i * PER_SHEET, (i + 1) * PER_SHEET).map((s) => config.baseUrl + "/g/" + s));
      const pdf = await buildPdf("gold", pages, { title: "Gold sheets", isAborted: aborted });
      if (!pdf || aborted()) { await discardCards(db, slugs); return; } // the admin left: nothing was handed over
      sendPdf(res, pdf, "gold-" + sheets + "-sheets-" + stamp() + ".pdf");
    } catch (err) {
      if (slugs.length) await discardCards(db, slugs).catch(() => {});
      throw err;
    } finally {
      makingGold = false;
    }
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
  // In production the page, stylesheet and scripts are served pre-compressed (see assets.js).
  // While developing, files are read from disk on every request so edits show up straight away.
  const assets = config.isProd ? createAssets(PUBLIC_DIR) : null;

  // The homepage ("/") is itself a gift (see HOME_WISH in app.js). A card link that cannot possibly be real goes straight there;
  // a well-formed link that is unknown or expired is sent there by the page itself once the lookup says so.
  app.get("/g/:slug", (req, res) => {
    if (!SLUG.test(req.params.slug)) return res.redirect(302, "/");
    if (assets) return assets.page(req, res, "/index.html");
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
  if (assets) app.use(assets.middleware);
  // Fonts never change under the same name, so browsers keep them for a year.
  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (file.endsWith(".woff2")) res.set("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));
  // Any other address (old links, typos, the retired /greet page) lands on the homepage.
  // Missing files, such as an absent image, still get a plain 404.
  app.use((req, res) => {
    if ((req.method === "GET" || req.method === "HEAD") && !path.extname(req.path)) return res.redirect(302, "/");
    res.status(404).type("text").send("Not found");
  });

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
