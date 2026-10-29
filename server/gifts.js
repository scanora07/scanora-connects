"use strict";

const express = require("express");
const { sameOrigin } = require("./auth");
const { rateLimit } = require("./ratelimit");

// Same alphabet and length as the links the admin page creates (see slugs.js).
// Anything else cannot be a real card, so it is refused without touching the database.
const SLUG = /^[a-hj-km-np-z2-9]{10}$/;

const MAX = { wish: 80, letter: 800 };
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
// The wish is required. The letter is optional: when it is empty it is stored as null, and the
// gift page then shows its built-in letter instead.
function validateGift(body) {
  const b = body && typeof body === "object" ? body : {};
  const wish = clean(b.wish, false);
  if (wish === null || !wish) return { error: "Please write your wish." };
  if (length(wish) > MAX.wish) return { error: "The wish is too long (at most " + MAX.wish + " characters)." };

  let letter = null;
  if (b.letter !== undefined && b.letter !== null) {
    const cleaned = clean(b.letter, true);
    if (cleaned === null) return { error: "The letter must be text." };
    if (length(cleaned) > MAX.letter) return { error: "The letter is too long (at most " + MAX.letter + " characters)." };
    letter = cleaned || null;
  }

  if (LINK.test(wish + " " + (letter || ""))) return { error: "Links are not allowed." };
  return { gift: { wish, letter } };
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
      "SELECT status, wish, letter, (expires_at <= now()) AS lapsed FROM gifts WHERE slug = $1",
      [slug]
    );
    if (!rows.length) return res.status(404).json({ status: "gone" });
    const g = rows[0];

    if (g.status === "empty") return res.json({ status: "empty", days: giftDays });

    if (!g.lapsed) return res.json({ status: "active", gift: { wish: g.wish, letter: g.letter } });

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
    const { wish, letter } = checked.gift;

    // One atomic statement: if two people submit at the same moment, exactly one of them wins
    const { rows } = await db.query(
      `UPDATE gifts
          SET status = 'active', wish = $2, letter = $3,
              filled_at = now(), expires_at = now() + make_interval(days => $4::int)
        WHERE slug = $1 AND status = 'empty'
        RETURNING id`,
      [slug, wish, letter, giftDays]
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
