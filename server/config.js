"use strict";

const path = require("path");
const crypto = require("crypto");

// Load ".env" when it exists (values already set in the environment win, as on Render).
// ENV_FILE=none skips it, which the automated tests use so they never touch the real database.
if (process.env.ENV_FILE !== "none") {
  try {
    process.loadEnvFile(path.join(__dirname, "..", ".env"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 5173;

function fail(message) {
  console.error("\nConfiguration problem: " + message + "\n");
  process.exit(1);
}

const adminPasskey = process.env.ADMIN_PASSKEY || "";
if (!adminPasskey) {
  fail("ADMIN_PASSKEY is not set. Copy .env.example to .env and fill it in (or set it in Render's Environment).");
}

// How many days a gift stays available after the sender fills the form
const giftDays = Number(process.env.GIFT_DAYS || 7);
if (!Number.isInteger(giftDays) || giftDays < 1 || giftDays > 365) fail("GIFT_DAYS must be a whole number from 1 to 365.");

// The secret the free scheduler sends to run the daily cleanup. Without it the cleanup address is switched off.
const cronSecret = process.env.CRON_SECRET || "";
if (cronSecret && cronSecret.length < 16) fail("CRON_SECRET is too short. Use at least 16 random characters.");

let sessionSecret = process.env.SESSION_SECRET || "";
if (!sessionSecret) {
  if (isProd) fail("SESSION_SECRET is not set. Use a long random string.");
  sessionSecret = crypto.randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET is not set, using a temporary one (you will be signed out on every restart).");
}
if (isProd && sessionSecret.length < 24) fail("SESSION_SECRET is too short. Use at least 24 random characters.");

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl && isProd) fail("DATABASE_URL is not set. Paste your Neon connection string.");

let baseUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
if (!baseUrl) {
  if (isProd) fail("PUBLIC_BASE_URL is not set. It is printed in every QR code, so it must be your real address.");
  baseUrl = "http://localhost:" + port;
}
if (isProd && !/^https:\/\//i.test(baseUrl)) fail("PUBLIC_BASE_URL must start with https:// in production.");

const maxBatch = Math.max(1, Math.min(5000, Number(process.env.MAX_BATCH) || 1000));

module.exports = {
  isProd,
  port,
  adminPasskey,
  sessionSecret,
  databaseUrl,
  baseUrl,
  maxBatch,
  giftDays,
  cronSecret,
  dataDir: path.join(__dirname, "..", ".data"),
};
