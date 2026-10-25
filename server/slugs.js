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

// Creates a batch and exactly `count` brand-new empty gift cards, all or nothing.
// The batch also remembers its links (in order), so its ZIP can be downloaded again later
// even after some of its gift rows have expired and been deleted.
// Returns { batch, slugs }.
async function createBatch(db, { count, label }) {
  return db.tx(async (q) => {
    const { rows } = await q(
      "INSERT INTO batches (label, count) VALUES ($1, $2) RETURNING id, label, count, created_at",
      [label || null, count]
    );
    const batch = rows[0];

    let created = 0;
    for (let round = 0; created < count; round++) {
      if (round > 12) throw new Error("Could not generate enough unique links, please try again.");
      const wanted = new Set();
      while (wanted.size < count - created) wanted.add(makeSlug());
      // A slug that already exists is skipped by the unique constraint, and the next round tops up
      const res = await q(
        "INSERT INTO gifts (slug, batch_id) SELECT s, $2 FROM unnest($1::text[]) AS s ON CONFLICT (slug) DO NOTHING RETURNING id",
        [[...wanted], batch.id]
      );
      created += res.rows.length;
    }

    const slugs = (await q("SELECT slug FROM gifts WHERE batch_id = $1 ORDER BY id", [batch.id])).rows.map((r) => r.slug);
    await q("UPDATE batches SET slugs = $2::text[] WHERE id = $1", [batch.id, slugs]);
    return { batch, slugs };
  });
}

async function listBatches(db, limit = 200) {
  const { rows } = await db.query(
    "SELECT id, label, count, created_at FROM batches ORDER BY id DESC LIMIT $1",
    [limit]
  );
  return rows;
}

// The batch and the exact links it issued, taken from the batch itself (not from the gift rows)
async function getBatch(db, id) {
  const { rows } = await db.query("SELECT id, label, count, slugs, created_at FROM batches WHERE id = $1", [id]);
  if (!rows.length) return null;
  const { slugs, ...batch } = rows[0];
  return { batch, slugs };
}

module.exports = { ALPHABET, SLUG_LENGTH, makeSlug, createBatch, listBatches, getBatch };
