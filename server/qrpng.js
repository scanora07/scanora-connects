"use strict";

// Draws a QR code as a PNG image without any image library, so a whole batch is quick to make
// even on a small free server. The image is 1-bit (black and white), which keeps each file tiny
// (a few KB), and every QR dot is an exact whole number of pixels, so the edges are perfectly sharp.

const zlib = require("zlib");
const QRCode = require("qrcode");

const QUIET = 4;        // the clear white border a QR code needs around it, in dots
const TARGET_PX = 1000; // about this many pixels wide: plenty for printing a QR a few centimetres across

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Returns a PNG (Buffer) of the QR code for `text`
function qrPng(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const dots = n + 2 * QUIET;
  const scale = Math.max(8, Math.floor(TARGET_PX / dots));
  const side = dots * scale;
  const stride = ((side + 7) >> 3) + 1; // one filter byte + the bits of a row

  // Every pixel starts white (bit 1); dark dots clear their bits. Row filter bytes stay 0.
  const raw = Buffer.alloc(stride * side, 0xff);
  for (let y = 0; y < side; y++) raw[y * stride] = 0;

  const line = Buffer.alloc(stride);
  for (let r = 0; r < n; r++) {
    line.fill(0xff);
    line[0] = 0;
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      const x0 = (c + QUIET) * scale;
      for (let x = x0; x < x0 + scale; x++) line[1 + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
    const top = (r + QUIET) * scale;
    for (let k = 0; k < scale; k++) line.copy(raw, (top + k) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 1; // bit depth: 1
  ihdr[9] = 0; // colour type: greyscale
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { qrPng, QUIET };
