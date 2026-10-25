"use strict";

const { zipSync } = require("fflate");
const { qrPng } = require("./qrpng");

// Builds the ZIP for a batch: one QR code image per link, named in print order and with the link's own
// ID so a file can always be matched to its card, for example  0007-k3m9x2ab7c.png
// Returns a Buffer, or null if the browser went away before it was finished.
async function buildCardsZip(slugs, baseUrl, { isAborted = () => false } = {}) {
  const digits = Math.max(4, String(slugs.length).length);
  const files = {};
  for (let i = 0; i < slugs.length; i++) {
    if (isAborted()) return null;
    const name = String(i + 1).padStart(digits, "0") + "-" + slugs[i] + ".png";
    files[name] = qrPng(baseUrl + "/g/" + slugs[i]);
    // Let the server answer other requests (like the keep-alive ping) while a big batch is built
    if (i % 25 === 24) await new Promise((resolve) => setImmediate(resolve));
  }
  // PNG images are already compressed, so they are stored as they are (level 0) which is also fastest
  return Buffer.from(zipSync(files, { level: 0 }));
}

module.exports = { buildCardsZip };
