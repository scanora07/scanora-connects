"use strict";

const express = require("express");
const { sameOrigin } = require("./auth");
const { rateLimit } = require("./ratelimit");

// Same alphabet and length as the links the admin page creates (see slugs.js).
// Anything else cannot be a real card, so it is refused without touching the database.
const SLUG = /^[a-hj-km-np-z2-9]{10}$/;

const MAX = { name: 40, wish: 60, message: 800 };
const LINK = /https?:\/\/|www\./i;
// Invisible characters that can be used to disguise text (direction overrides, joiners other than emoji ones, BOM)
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

// Returns the cleaned text, or null when it is not text at all
function clean(value, multiline) {
  if (typeof value !== "string") return null;
  let s = value.normalize("NFC").replace(INVISIBLE, "").replace(/\r\n?/g, "\n");
  if (multiline) {
    s = s.replace(CONTROL_KEEP_NEWLINE, "").replace(/\n{3,}/g, "\n\n");
  } else {
    s = s.replace(/\s+/g, " ").replace(CONTROL_ALL, "");
  }
  return s.trim();
}

const length = (s) => [...s].length; // counts characters (an emoji is one), like a person would

// Checks what the sender typed. Returns { gift } when fine, or { error } with a message for them.
function validateGift(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = clean(b.name, false);
  const wish = clean(b.wish, false);
  const message = clean(b.message, true);
  if (name === null || wish === null || message === null) return { error: "Please fill in the name, wish and message." };
  if (!name || !wish || !message) return { error: "Please fill in the name, wish and message." };
  if (length(name) > MAX.name) return { error: "The name is too long (at most " + MAX.name + " characters)." };
  if (length(wish) > MAX.wish) return { error: "The wish is too long (at most " + MAX.wish + " characters)." };
  if (length(message) > MAX.message) return { error: "The message is too long (at most " + MAX.message + " characters)." };
  if (LINK.test(name + " " + wish + " " + message)) return { error: "Links are not allowed." };
  return { gift: { name, wish, message } };
}

function createGiftRouter(db, { giftDays, limits = {} }) {
  const router = express.Router();
  const readLimit = rateLimit({ windowMs: 60000, max: limits.read || 120 });
  const writeLimit = rateLimit({ windowMs: 60000, max: limits.write || 12, message: "Too many attempts. Please wait a minute and try again." });

  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  // What is on this card? "empty" (show the form), "active" (show the gift) or "gone" (the link no
  // longer works: it expired and its row was deleted, or it was never a real card). The page sends
  // the visitor to the greeting page when a card is gone.
  router.get("/gift/:slug", readLimit, async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return res.status(404).json({ status: "gone" });

    const { rows } = await db.query(
      "SELECT status, name, wish, message, (expires_at <= now()) AS lapsed FROM gifts WHERE slug = $1",
      [slug]
    );
    if (!rows.length) return res.status(404).json({ status: "gone" });
    const g = rows[0];

    if (g.status === "empty") return res.json({ status: "empty", days: giftDays });

    if (!g.lapsed) return res.json({ status: "active", gift: { name: g.name, wish: g.wish, message: g.message } });

    // The time is up: delete the whole row right now, so nothing personal is kept
    await db.query("DELETE FROM gifts WHERE slug = $1 AND status = 'active' AND expires_at <= now()", [slug]);
    res.status(404).json({ status: "gone" });
  });

  // The sender confirms their gift. It only works on a card that is still empty, and only once.
  router.post("/gift/:slug", sameOrigin, writeLimit, express.json({ limit: "8kb" }), async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return res.status(404).json({ error: "This card was not found." });

    const checked = validateGift(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const { name, wish, message } = checked.gift;

    // One atomic statement: if two people submit at the same moment, exactly one of them wins
    const { rows } = await db.query(
      `UPDATE gifts
          SET status = 'active', name = $2, wish = $3, message = $4,
              filled_at = now(), expires_at = now() + make_interval(days => $5::int)
        WHERE slug = $1 AND status = 'empty'
        RETURNING id`,
      [slug, name, wish, message, giftDays]
    );
    if (rows.length) return res.json({ ok: true });

    const exists = await db.query("SELECT 1 FROM gifts WHERE slug = $1", [slug]);
    if (!exists.rows.length) return res.status(404).json({ error: "This card was not found." });
    res.status(409).json({ error: "This card has already been filled in." });
  });

  return router;
}

// Deletes every gift whose time is up (the whole row). Safe to run as often as you like.
// Returns how many rows were deleted.
async function deleteExpired(db) {
  const { rows } = await db.query("DELETE FROM gifts WHERE status = 'active' AND expires_at <= now() RETURNING id");
  return rows.length;
}

module.exports = { createGiftRouter, deleteExpired, validateGift, SLUG };
