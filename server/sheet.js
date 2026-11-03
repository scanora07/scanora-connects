"use strict";

// Builds the print-ready sheets: a PDF where every page is one 13 x 19 in sheet holding 40 cards
// (5 across, 8 down). The shop only has to print it at 100% scale and cut along the small tick marks.
//
//  - The card picture (server/art/silver.jpg|png and gold.jpg|png) is stored once in the PDF and drawn
//    on every card, so even a hundred sheets stay a few MB. It is placed exactly on the card, so a
//    spot on your picture is a spot on the card. A slightly enlarged copy is drawn underneath, which
//    only shows in the thin strip that is cut away, so a cut that is a little off never leaves a
//    white sliver.
//  - The QR code and the white square behind it are drawn as vector shapes, so they are perfectly
//    sharp at any print resolution. The dark dots use pure black ink (100% K) only, never a mix of
//    inks, which can show coloured fringes if the printer's colours are a hair out of line.
//
// A PDF with one image and plain drawing commands is simple to write directly, so no PDF library is used.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const QRCode = require("qrcode");
const { PNG } = require("pngjs");
const L = require("./layout");

const PT = 72; // points per inch
const QUIET = 4; // clear border a QR code needs around it, in dots
const QR_LEVEL = "Q"; // survives scuffs and slightly rough cutting better than the common M

// ---------------------------------------------------------------- the card pictures

// The two pictures go in server/art, named silver and gold, as .jpg or .png. They are read again
// whenever they change, so swapping a picture needs no restart.
const ART_DIR = path.join(__dirname, "art");
const cache = new Map();

function findArt(edition) {
  for (const ext of [".jpg", ".jpeg", ".png"]) {
    const file = path.join(ART_DIR, edition + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// JPG is put in the PDF as it is; PNG is decoded and re-packed (transparent areas become white paper)
function loadArt(edition) {
  const file = findArt(edition);
  if (!file) throw new Error("The " + edition + " card picture is missing. Put it in server/art as " + edition + ".jpg or " + edition + ".png.");
  const stat = fs.statSync(file);
  const key = file + stat.size + stat.mtimeMs;
  if (cache.has(edition) && cache.get(edition).key === key) return cache.get(edition);

  const bytes = fs.readFileSync(file);
  let art;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let pos = 2; // walk the JPG's blocks until the one that holds its size
    while (pos + 9 < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] >= 0xc0 && bytes[pos + 1] <= 0xc2)) {
      pos += bytes[pos + 1] === 0xd8 ? 2 : 2 + bytes.readUInt16BE(pos + 2);
    }
    if (pos + 9 >= bytes.length) throw new Error(path.basename(file) + " is not a normal JPG. Save it again as a JPG or PNG.");
    art = { kind: "jpeg", mime: "image/jpeg", stream: bytes, height: bytes.readUInt16BE(pos + 5), width: bytes.readUInt16BE(pos + 7), components: bytes[pos + 9] };
  } else if (bytes.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(bytes);
    const rgb = Buffer.alloc(png.width * png.height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      const k = png.data[i + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[j + c] = Math.round(png.data[i + c] * k + 255 * (1 - k));
    }
    art = { kind: "png", mime: "image/png", stream: zlib.deflateSync(rgb, { level: 6 }), width: png.width, height: png.height, components: 3 };
  } else {
    throw new Error(path.basename(file) + " is not a JPG or PNG picture.");
  }
  art.key = key;
  art.original = bytes;
  cache.set(edition, art);
  return art;
}

// null when the picture is usable, otherwise the reason (shown on the admin page)
function artProblem(edition) {
  try {
    loadArt(edition);
    return null;
  } catch (err) {
    return err.message;
  }
}

// The white square for a card's QR code, in points from the card's top-left corner
function qrBox(edition) {
  const q = L.QR[edition];
  return { x: q.x * PT, y: q.y * PT, size: q.size * PT };
}
// ---------------------------------------------------------------- QR codes

// The dark dots of a QR code as horizontal runs: [row, firstColumn, length]. Also returns the size in dots.
// The silver sheet draws the same address 40 times, so the last few results are kept.
const runsCache = new Map();
function qrRuns(text) {
  if (runsCache.has(text)) return runsCache.get(text);
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_LEVEL });
  const n = qr.modules.size;
  const runs = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; ) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let end = c;
      while (end < n && qr.modules.get(r, end)) end++;
      runs.push([r, c, end - c]);
      c = end;
    }
  }
  const result = { n, runs };
  if (runsCache.size > 64) runsCache.clear();
  runsCache.set(text, result);
  return result;
}

// ---------------------------------------------------------------- drawing helpers

const num = (v) => String(Math.round(v * 1000) / 1000);

const sheetW = L.SHEET.width * PT;
const sheetH = L.SHEET.height * PT;
const cardPt = L.CARD * PT;
const bleedPt = L.BLEED * PT;

// Where a card's trim corner sits on the sheet, in points from the top-left of the page
function cardOrigin(row, col) {
  return {
    x: (L.MARGIN.x + col * (L.CARD + L.GUTTER)) * PT,
    y: (L.MARGIN.y + row * (L.CARD + L.GUTTER)) * PT,
  };
}

// Draws one card: the picture, the white square and the QR code
function drawCard(row, col, url, qr) {
  const o = cardOrigin(row, col);
  const out = [];
  // First a slightly enlarged copy that reaches into the strip that gets cut away, then the picture
  // exactly on the card, which covers it everywhere inside the card.
  const big = cardPt + 2 * bleedPt;
  out.push(`q ${num(big)} 0 0 ${num(big)} ${num(o.x - bleedPt)} ${num(sheetH - (o.y + cardPt + bleedPt))} cm /Art Do Q`);
  out.push(`q ${num(cardPt)} 0 0 ${num(cardPt)} ${num(o.x)} ${num(sheetH - (o.y + cardPt))} cm /Art Do Q`);

  const px = o.x + qr.x;
  const py = o.y + qr.y;
  out.push("0 0 0 0 k"); // paper white: no ink at all, the best contrast the QR code can get
  out.push(`${num(px)} ${num(sheetH - (py + qr.size))} ${num(qr.size)} ${num(qr.size)} re`); // a perfect square
  out.push("f");

  const { n, runs } = qrRuns(url);
  const m = qr.size / (n + 2 * QUIET);
  out.push("0 0 0 1 k"); // 100% black ink only
  for (const [r, c, len] of runs) {
    out.push(`${num(px + (QUIET + c) * m)} ${num(sheetH - (py + (QUIET + r + 1) * m))} ${num(len * m)} ${num(m)} re`);
  }
  out.push("f");
  return out.join("\n");
}

// Short tick marks in the margins at every place the sheet is cut (both edges of every card)
function cutMarks() {
  const out = ["0 0 0 1 K", "0.3 w"];
  const tick = (x1, y1, x2, y2) => out.push(`${num(x1)} ${num(sheetH - y1)} m ${num(x2)} ${num(sheetH - y2)} l S`);
  for (let c = 0; c < L.COLS; c++) {
    const left = cardOrigin(0, c).x;
    for (const x of [left, left + cardPt]) {
      tick(x, 0.02 * PT, x, 0.09 * PT);
      tick(x, sheetH - 0.09 * PT, x, sheetH - 0.02 * PT);
    }
  }
  for (let r = 0; r < L.ROWS; r++) {
    const top = cardOrigin(r, 0).y;
    for (const y of [top, top + cardPt]) {
      tick(0.2 * PT, y, 0.45 * PT, y);
      tick(sheetW - 0.45 * PT, y, sheetW - 0.2 * PT, y);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- PDF file

const OBJ_ART = 4;
const FIRST_PAGE = 5;

// pages: an array of sheets, each an array of up to PER_SHEET QR texts (left to right, top to bottom).
// It builds one sheet at a time and lets the server breathe in between, so a large job does not freeze
// other visitors on a small server. Returns null if isAborted() turns true (the admin closed the page).
async function buildPdf(edition, pages, { title = "Cards", isAborted = () => false } = {}) {
  if (!pages.length) throw new Error("Nothing to print.");
  const art = loadArt(edition);
  const qr = qrBox(edition);
  const marks = cutMarks();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const add = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1"); parts.push(buf); pos += buf.length; };
  const object = (id, dict, stream) => {
    offsets[id] = pos;
    add(`${id} 0 obj\n<< ${dict}${stream ? ` /Length ${stream.length}` : ""} >>\n`);
    if (stream) { add("stream\n"); add(stream); add("\nendstream\n"); }
    add("endobj\n");
  };

  add("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  object(1, "/Type /Catalog /Pages 2 0 R");
  const kids = pages.map((_, i) => `${FIRST_PAGE + 2 * i} 0 R`).join(" ");
  object(2, `/Type /Pages /Kids [${kids}] /Count ${pages.length}`);
  const stamp = "D:" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  object(3, `/Title (${String(title).replace(/[()\\]/g, "")}) /Producer (Scanora Connects) /CreationDate (${stamp})`);
  object(
    OBJ_ART,
    `/Type /XObject /Subtype /Image /Width ${art.width} /Height ${art.height} /BitsPerComponent 8 ` +
      `/ColorSpace /${art.components === 1 ? "DeviceGray" : "DeviceRGB"} /Filter /${art.kind === "jpeg" ? "DCTDecode" : "FlateDecode"}`,
    art.stream
  );

  const box = `[0 0 ${num(sheetW)} ${num(sheetH)}]`;
  for (let i = 0; i < pages.length; i++) {
    if (isAborted()) return null;
    const id = FIRST_PAGE + 2 * i;
    object(id, `/Type /Page /Parent 2 0 R /MediaBox ${box} /TrimBox ${box} /BleedBox ${box} /Resources << /XObject << /Art ${OBJ_ART} 0 R >> >> /Contents ${id + 1} 0 R`);
    const drawing = [];
    pages[i].slice(0, L.PER_SHEET).forEach((url, k) => drawing.push(drawCard(Math.floor(k / L.COLS), k % L.COLS, url, qr)));
    drawing.push(marks);
    object(id + 1, "/Filter /FlateDecode", zlib.deflateSync(Buffer.from(drawing.join("\n"), "latin1"), { level: 6 }));
    await new Promise((resolve) => setImmediate(resolve));
  }

  const count = FIRST_PAGE + 2 * pages.length;
  const xref = pos;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  add(table + `trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- admin preview

// A picture of one finished card, as an SVG: your picture plus the real white square and QR code.
// The units are 1/1000 of a card, so the picture and the square line up exactly as they will print.
function previewSvg(edition, url) {
  const art = loadArt(edition);
  const k = 1000 / L.CARD;
  const q = L.QR[edition];
  const x = q.x * k, y = q.y * k, size = q.size * k;
  const { n, runs } = qrRuns(url);
  const m = size / (n + 2 * QUIET);
  const d = runs.map(([r, c, len]) => `M${num(x + (QUIET + c) * m)} ${num(y + (QUIET + r) * m)}h${num(len * m)}v${num(m)}h${num(-len * m)}z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">` +
    `<image href="data:${art.mime};base64,${art.original.toString("base64")}" width="1000" height="1000" preserveAspectRatio="none"/>` +
    `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>`;
}

module.exports = { buildPdf, previewSvg, artProblem, qrRuns, QR_LEVEL };
