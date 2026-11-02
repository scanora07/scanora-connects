"use strict";

// Serves the page, stylesheet and scripts compressed. Each file is compressed once at startup (the
// smallest brotli and gzip versions) and kept in memory, so a request costs no CPU on a small free
// server and the visitor downloads roughly a third of the bytes. Fonts are already compressed, so they
// already compressed, so they are left to express.static.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function loadAssets(dir) {
  const assets = new Map();
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (TYPES[path.extname(file)]) {
        const raw = fs.readFileSync(file);
        assets.set("/" + path.relative(dir, file).split(path.sep).join("/"), {
          type: TYPES[path.extname(file)],
          etag: 'W/"' + crypto.createHash("sha1").update(raw).digest("base64url").slice(0, 16) + '"',
          raw,
          br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
          gzip: zlib.gzipSync(raw, { level: 9 }),
        });
      }
    }
  })(dir);
  return assets;
}

function send(req, res, asset, cacheControl) {
  res.vary("Accept-Encoding");
  res.set({ "Content-Type": asset.type, "Cache-Control": cacheControl, ETag: asset.etag });
  if (req.fresh) return res.status(304).end();
  const accepts = String(req.headers["accept-encoding"] || "");
  let body = asset.raw;
  if (/\bbr\b/.test(accepts)) {
    res.set("Content-Encoding", "br");
    body = asset.br;
  } else if (/\bgzip\b/.test(accepts)) {
    res.set("Content-Encoding", "gzip");
    body = asset.gzip;
  }
  res.set("Content-Length", String(body.length));
  res.end(req.method === "HEAD" ? undefined : body);
}

// Returns { middleware, page } where middleware serves any compressible file by its address
// ("/" and "/admin/" map to their index.html) and page(path) serves one specific file.
function createAssets(dir, { maxAge }) {
  const assets = loadAssets(dir);
  const cacheControl = "public, max-age=" + maxAge;
  return {
    middleware(req, res, next) {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const asset = assets.get(req.path.endsWith("/") ? req.path + "index.html" : req.path);
      if (!asset) return next();
      send(req, res, asset, cacheControl);
    },
    page(req, res, file) {
      send(req, res, assets.get(file), "no-cache");
    },
  };
}

module.exports = { createAssets };
