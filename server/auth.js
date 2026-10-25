"use strict";

const crypto = require("crypto");
const config = require("./config");

// The admin session is a signed cookie, so no session storage is needed.
// Cookie: HttpOnly (scripts cannot read it), SameSite=Strict (other sites cannot use it),
// Secure on https, and limited to the admin API path.
const COOKIE = "scanora_admin";
const COOKIE_PATH = "/api/admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

// Wrong guesses: 5 in a row from one address locks that address out for 15 minutes
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map();

const sha = (s) => crypto.createHash("sha256").update(s).digest();
const sign = (value) => crypto.createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Signing out invalidates every session issued before that moment, even if someone kept a copy of the cookie
let revokedBefore = 0;

// Comparing hashes of both values, in constant time, so the comparison leaks nothing about the passkey
function passkeyMatches(input) {
  return crypto.timingSafeEqual(sha(input), sha(config.adminPasskey));
}

function makeToken() {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + SESSION_MS })).toString("base64url");
  return payload + "." + sign(payload);
}

function tokenValid(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return false;
  const good = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return false;
  try {
    const { iat, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() && iat >= revokedBefore;
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function setCookie(req, res, value, maxAgeSec) {
  const flags = ["Path=" + COOKIE_PATH, "HttpOnly", "SameSite=Strict", "Max-Age=" + maxAgeSec];
  if (req.secure) flags.push("Secure");
  res.append("Set-Cookie", COOKIE + "=" + value + "; " + flags.join("; "));
}

function prune() {
  if (attempts.size < 500) return;
  const now = Date.now();
  for (const [ip, rec] of attempts) if (rec.until < now && rec.fails === 0) attempts.delete(ip);
}

async function login(req, res) {
  const now = Date.now();
  const rec = attempts.get(req.ip) || { fails: 0, until: 0 };
  if (rec.until > now) {
    const minutes = Math.ceil((rec.until - now) / 60000);
    return res.status(429).json({ error: "Too many wrong attempts. Try again in " + minutes + " minute" + (minutes === 1 ? "" : "s") + "." });
  }

  const given = req.body && typeof req.body.passkey === "string" ? req.body.passkey : "";
  if (!given || given.length > 200 || !passkeyMatches(given)) {
    await delay(400); // slows down guessing
    rec.fails += 1;
    if (rec.fails >= MAX_FAILS) { rec.until = Date.now() + LOCK_MS; rec.fails = 0; }
    attempts.set(req.ip, rec);
    prune();
    return res.status(401).json({ error: "Wrong passkey." });
  }

  attempts.delete(req.ip);
  setCookie(req, res, makeToken(), SESSION_MS / 1000);
  res.json({ ok: true });
}

function logout(req, res) {
  revokedBefore = Date.now();
  setCookie(req, res, "", 0);
  res.json({ ok: true });
}

const isSignedIn = (req) => tokenValid(readCookie(req, COOKIE));

// Constant-time comparison of two secrets (hashes first, so different lengths are fine)
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(String(a)), sha(String(b)));

function requireAuth(req, res, next) {
  if (isSignedIn(req)) return next();
  res.status(401).json({ error: "Please sign in." });
}

// Refuses requests that come from another website (extra protection on top of SameSite)
function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* handled below */ }
    if (host !== req.get("host")) return res.status(403).json({ error: "Request blocked." });
  }
  next();
}

module.exports = { login, logout, isSignedIn, requireAuth, sameOrigin, safeEqual };
