"use strict";

// Serves the page, stylesheet and scripts compressed. Each file is compressed once at startup (the
// smallest brotli and gzip versions) and kept in memory, so a request costs no CPU on a small free
// server and the visitor downloads roughly a third of the bytes. Fonts are already compressed, so they
// are left to express.static.
//
// Caching: the HTML pages are always revalidated (a cheap "304 not modified" when nothing changed), and
// the stylesheet and scripts they load get a fingerprint of their content in the address
// (/app.js?v=3fA9...). A fingerprinted file can be cached forever, and when a file changes its address
// changes too, so a visitor can never end up with a new page running an old script.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const FOREVER = "public, max-age=31536000, immutable";

const hash = (buf, length) => crypto.createHash("sha1").update(buf).digest("base64url").slice(0, length);

function loadAssets(dir) {
  const files = new Map(); // address -> file contents
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (TYPES[path.extname(file)]) files.set("/" + path.relative(dir, file).split(path.sep).join("/"), fs.readFileSync(file));
    }
  })(dir);

  const assets = new Map();
  for (const [address, contents] of files) {
    let raw = contents;
    if (address.endsWith(".html")) {
      // Point the page at fingerprinted copies of its stylesheet and scripts
      raw = Buffer.from(contents.toString("utf8").replace(/\b(src|href)="([^"#?:]+\.(?:css|js))"/g, (match, attr, ref) => {
        const target = ref.startsWith("/") ? ref : path.posix.join(path.posix.dirname(address), ref);
        return files.has(target) ? attr + '="' + ref + "?v=" + hash(files.get(target), 10) + '"' : match;
      }));
    }
    assets.set(address, {
      type: TYPES[path.extname(address)],
      isPage: address.endsWith(".html"),
      etag: 'W/"' + hash(raw, 16) + '"',
      raw,
      br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
      gzip: zlib.gzipSync(raw, { level: 9 }),
    });
  }
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
// ("/" and "/admin/" map to their index.html) and page(req, res, file) serves one specific page.
function createAssets(dir) {
  const assets = loadAssets(dir);
  return {
    middleware(req, res, next) {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const asset = assets.get(req.path.endsWith("/") ? req.path + "index.html" : req.path);
      if (!asset) return next();
      // Only the fingerprinted address is cached forever. The same file asked for without one (say, by
      // a page a browser saved before this existed) is always revalidated.
      send(req, res, asset, !asset.isPage && req.query.v ? FOREVER : "no-cache");
    },
    page(req, res, file) {
      send(req, res, assets.get(file), "no-cache");
    },
  };
}

module.exports = { createAssets };
