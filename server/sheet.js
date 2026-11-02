"use strict";

// Builds the print-ready sheets: a PDF where every page is one 13 x 19 in sheet holding 40 cards
// (5 across, 8 down). The shop only has to print it at 100% scale and cut along the small tick marks.
//
//  - The card artwork (server/art/<edition>.png, made by design/build.js) is stored once in the PDF
//    and drawn on every card, so even a hundred sheets stay a few MB.
//  - The QR code and the white plate behind it are drawn as vector shapes, so they are perfectly
//    sharp at any print resolution. The dark dots use pure black ink (100% K) only, never a mix of
//    inks, which can show coloured fringes if the printer's colours are a hair out of line.
//  - Each card's artwork runs half a gutter past its trim edge, so neighbouring cards touch and a
//    cut that is a little off never leaves a white sliver.
//
// No library is used: a PDF with one image and plain drawing commands is simple to write directly.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const QRCode = require("qrcode");
const L = require("./layout");

const ART_DIR = path.join(__dirname, "art");
const PT = 72; // points per inch
const QUIET = 4; // clear border a QR code needs around it, in dots
const QR_LEVEL = "Q"; // survives scuffs and slightly rough cutting better than the common M

// ---------------------------------------------------------------- artwork

const artCache = new Map();

// Reads a PNG and returns what a PDF needs to embed it as it is: the size and the compressed pixel data.
// (PDF can use PNG's own compression directly, as long as the image is plain 8-bit RGB.)
function loadArt(edition) {
  if (artCache.has(edition)) return artCache.get(edition);
  const file = path.join(ART_DIR, edition + ".png");
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    throw new Error("Card artwork is missing (" + file + "). Run: npm run build:art");
  }
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(file + " is not a PNG.");
  let width = 0, height = 0;
  const idat = [];
  for (let pos = 8; pos < buf.length; ) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error(file + " must be a plain 8-bit RGB PNG (run npm run build:art).");
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (width !== L.ART_PX || height !== L.ART_PX) throw new Error(file + " must be " + L.ART_PX + " x " + L.ART_PX + " pixels.");
  const art = { width, height, data: Buffer.concat(idat) };
  artCache.set(edition, art);
  return art;
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
const plate = {
  size: (L.PLATE_PX.size / L.DPI) * PT,
  top: (L.PLATE_PX.top / L.DPI) * PT,
};

// Where a card's trim corner sits on the sheet, in points from the top-left of the page
function cardOrigin(row, col) {
  return {
    x: (L.MARGIN.x + col * (L.CARD + L.GUTTER)) * PT,
    y: (L.MARGIN.y + row * (L.CARD + L.GUTTER)) * PT,
  };
}

// Draws one card: its artwork, the white plate and the QR code
function drawCard(row, col, url) {
  const o = cardOrigin(row, col);
  const out = [];
  const artSize = cardPt + 2 * bleedPt;
  out.push(`q ${num(artSize)} 0 0 ${num(artSize)} ${num(o.x - bleedPt)} ${num(sheetH - (o.y + cardPt + bleedPt))} cm /Art Do Q`);

  const px = o.x + (cardPt - plate.size) / 2;
  const py = o.y + plate.top;
  out.push("0 0 0 0 k"); // paper white: no ink at all, the best contrast the QR code can get
  out.push(`${num(px)} ${num(sheetH - (py + plate.size))} ${num(plate.size)} ${num(plate.size)} re`); // a perfect square
  out.push("f");

  const { n, runs } = qrRuns(url);
  const m = plate.size / (n + 2 * QUIET);
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
    `/Type /XObject /Subtype /Image /Width ${art.width} /Height ${art.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${art.width} >>`,
    art.data
  );

  const box = `[0 0 ${num(sheetW)} ${num(sheetH)}]`;
  for (let i = 0; i < pages.length; i++) {
    if (isAborted()) return null;
    const id = FIRST_PAGE + 2 * i;
    object(id, `/Type /Page /Parent 2 0 R /MediaBox ${box} /TrimBox ${box} /BleedBox ${box} /Resources << /XObject << /Art ${OBJ_ART} 0 R >> >> /Contents ${id + 1} 0 R`);
    const drawing = [];
    pages[i].slice(0, L.PER_SHEET).forEach((url, k) => drawing.push(drawCard(Math.floor(k / L.COLS), k % L.COLS, url)));
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

// A picture of one finished card, as an SVG: the small artwork image plus the real plate and QR code
function previewSvg(edition, url) {
  const jpg = fs.readFileSync(path.join(ART_DIR, edition + "-preview.jpg")).toString("base64");
  const size = L.PLATE_PX.size;
  const x = L.BLEED_PX + (L.TRIM_PX - size) / 2;
  const y = L.BLEED_PX + L.PLATE_PX.top;
  const { n, runs } = qrRuns(url);
  const m = size / (n + 2 * QUIET);
  const d = runs.map(([r, c, len]) => `M${num(x + (QUIET + c) * m)} ${num(y + (QUIET + r) * m)}h${num(len * m)}v${num(m)}h${num(-len * m)}z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.ART_PX} ${L.ART_PX}">` +
    `<image href="data:image/jpeg;base64,${jpg}" width="${L.ART_PX}" height="${L.ART_PX}"/>` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>`;
}

module.exports = { buildPdf, previewSvg, qrRuns, QR_LEVEL };
