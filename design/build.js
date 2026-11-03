"use strict";

// Renders both card designs (design/card.js) into the images the server uses:
//   server/art/<edition>.png          the print artwork, 600 dpi, RGB, with bleed
//   server/art/<edition>-preview.jpg  a small copy for the admin page
//
// Run it after changing a design:   npm run build:art
// It needs a Chromium-based browser (Edge or Chrome) and the dev dependency playwright-core.
// Set BROWSER_PATH if the browser is not in one of the usual places.

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { chromium } = require("playwright-core");
const { EDITIONS, cardSvg } = require("./card");
const { ART_PX } = require("../server/layout");

const OUT = path.join(__dirname, "..", "server", "art");
const FONT = "data:font/woff2;base64," + fs.readFileSync(path.join(__dirname, "fonts", "Cinzel.woff2")).toString("base64");

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chrome or Edge found. Set BROWSER_PATH to its location.");
  return found;
}

const page = (svg) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "Cinzel"; font-weight: 400 900; src: url("${FONT}") format("woff2"); }
html, body { margin: 0; background: #000; } svg { display: block; }
</style>${svg}`;

// The screenshot has an alpha channel; the print file must be plain RGB (PDF embeds it directly)
function toRgbPng(buffer) {
  const src = PNG.sync.read(buffer);
  return PNG.sync.write(src, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    for (const edition of Object.keys(EDITIONS)) {
      for (const [size, kind] of [[ART_PX, "print"], [560, "preview"]]) {
        const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await p.setContent(page(cardSvg(edition, size)));
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(300);
        if (kind === "print") {
          const png = toRgbPng(await p.screenshot({ type: "png" }));
          fs.writeFileSync(path.join(OUT, edition + ".png"), png);
          console.log(edition + ".png", (png.length / 1024).toFixed(0) + " KB");
        } else {
          const jpg = await p.screenshot({ type: "jpeg", quality: 88 });
          fs.writeFileSync(path.join(OUT, edition + "-preview.jpg"), jpg);
          console.log(edition + "-preview.jpg", (jpg.length / 1024).toFixed(0) + " KB");
        }
        await p.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
