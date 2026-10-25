"use strict";

// One small database layer with two backends:
//  - Neon / any Postgres through "pg" when DATABASE_URL is set (production)
//  - an embedded Postgres (PGlite) stored in ".data" when it is not (local testing only)
//
// Both expose the same three functions, so the rest of the code does not care which is in use:
//   query(sql, params) -> { rows }
//   exec(sql)          -> runs one or more statements without parameters
//   tx(async (q) => {...}) -> runs q(sql, params) calls inside one transaction

const path = require("path");

const SCHEMA = `
-- One row per batch you create. "slugs" is the list of links that batch issued, in order. It is kept
-- on purpose: gift rows are deleted when they expire, but a batch's ZIP of QR codes must still be
-- re-downloadable, exactly as it was, at any time.
CREATE TABLE IF NOT EXISTS batches (
  id          SERIAL PRIMARY KEY,
  label       TEXT,
  count       INTEGER     NOT NULL,
  slugs       TEXT[]      NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per live gift card. A card starts "empty" (the QR is printed, nobody has filled it in),
-- becomes "active" when the sender fills it, and the whole row is DELETED when it expires.
CREATE TABLE IF NOT EXISTS gifts (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT        NOT NULL UNIQUE,
  batch_id   INTEGER     NOT NULL REFERENCES batches(id),
  status     TEXT        NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'active')),
  name       TEXT,
  wish       TEXT,
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at  TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gifts_batch_idx ON gifts (batch_id, id);
CREATE INDEX IF NOT EXISTS gifts_expiry_idx ON gifts (expires_at) WHERE status = 'active';
`;

// Brings a database made by an earlier version up to date. Every step is safe to run again.
const MIGRATIONS = `
ALTER TABLE batches DROP COLUMN IF EXISTS template_id;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS slugs TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE gifts DROP COLUMN IF EXISTS opened_at;

-- Batches made before the list was stored: rebuild it from the cards that still exist
UPDATE batches b
   SET slugs = (SELECT array_agg(g.slug ORDER BY g.id) FROM gifts g WHERE g.batch_id = b.id)
 WHERE cardinality(b.slugs) = 0
   AND EXISTS (SELECT 1 FROM gifts g WHERE g.batch_id = b.id);

-- "expired" is no longer a state: expired rows are deleted
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gifts_status_check' AND pg_get_constraintdef(oid) LIKE '%expired%') THEN
    DELETE FROM gifts WHERE status = 'expired';
    ALTER TABLE gifts DROP CONSTRAINT gifts_status_check;
    ALTER TABLE gifts ADD CONSTRAINT gifts_status_check CHECK (status IN ('empty', 'active'));
  END IF;
END $$;
`;

async function openPg(config) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 20000 });
  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn((sql, params) => client.query(sql, params));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openLocal(config) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    throw new Error("No DATABASE_URL set and the local database package is missing. Run: npm install");
  }
  const dir = path.join(config.dataDir, "pglite");
  require("fs").mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  return {
    kind: "local (PGlite)",
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn((sql, params) => t.query(sql, params))),
    close: () => db.close(),
  };
}

async function openDb(config) {
  const db = config.databaseUrl ? await openPg(config) : await openLocal(config);
  await db.exec(SCHEMA);
  await db.exec(MIGRATIONS);
  return db;
}

module.exports = { openDb };
