"use strict";

const crypto = require("crypto");

// 31 characters with nothing that can be misread: no 0/o, 1/i/l.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 10; // 31^10 is about 8 x 10^14 combinations, so guessing a live link is hopeless

function makeSlug() {
  let s = "";
  for (let i = 0; i < SLUG_LENGTH; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

// Creates exactly `count` brand-new empty gift cards, all or nothing, and returns their links in order.
// Nothing else is stored: no batch, no record of which sheet a card was printed on.
async function createCards(db, count) {
  return db.tx(async (q) => {
    const made = [];
    for (let round = 0; made.length < count; round++) {
      if (round > 12) throw new Error("Could not generate enough unique links, please try again.");
      const wanted = new Set();
      while (wanted.size < count - made.length) wanted.add(makeSlug());
      // A slug that already exists is skipped by the unique constraint, and the next round tops up
      const res = await q(
        "INSERT INTO gifts (slug) SELECT s FROM unnest($1::text[]) AS s ON CONFLICT (slug) DO NOTHING RETURNING slug",
        [[...wanted]]
      );
      for (const row of res.rows) made.push(row.slug);
    }
    return made;
  });
}

// Removes cards that were created but never made it onto a sheet (the PDF failed or the admin left)
async function discardCards(db, slugs) {
  await db.query("DELETE FROM gifts WHERE slug = ANY($1::text[]) AND status = 'empty'", [slugs]);
}

module.exports = { makeSlug, createCards, discardCards };
