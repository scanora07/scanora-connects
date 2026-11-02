"use strict";

// The two gift-card designs, drawn as SVG: a SILVER card (black and white tones) and a GOLD card
// (cream paper with gold foil). Both share one layout: a satin ribbon bow in the top-left corner
// with a heart tag, leaf sprigs, a gift box in the bottom-right corner, a gift icon and the
// greeting "A surprise for you", and square corner marks around the QR code.
// There is no brand name on the cards, so a shop can sell them as they are.
//
// build.js turns these into the print-ready images the server places on the sheets.
//
// Coordinates are in pixels of the finished card (2.25 in at 600 dpi = 1350). The artwork reaches
// BLEED_PX past every edge, so the SVG's viewBox starts at -BLEED_PX. Everything is a sharp-cornered square.
//
// The white square that holds the QR code is NOT drawn here: the server draws it (and the QR code)
// as sharp vector shapes. This file only leaves the right space for it, using the same numbers
// (PLATE_PX), and draws the four corner marks around that space.

const { TRIM_PX, BLEED_PX, ART_PX, PLATE_PX } = require("../server/layout");

const TEXT = "A surprise for you";
const TEXT_SIZE = 133; // Alex Brush at this size makes the greeting about 860 px wide

const THEMES = {
  silver: {
    paper: ["#ffffff", "#f2f3f6", "#dcdee4"],
    // foil: shadow, bright, mid, hot spot, mid, bright, shadow
    metal: ["#80858e", "#f6f7f9", "#adb2ba", "#ffffff", "#8f949d", "#e7e9ec", "#80858e"],
    // satin ribbon: softer than the foil, with one broad highlight
    satin: ["#868b94", "#e2e4e8", "#ffffff", "#aeb2b9", "#70757e"],
    ink: "#2f333a",
    boxTop: "#ffffff", boxLeft: "#eceef1", boxRight: "#d6d9de", boxEdge: "#aeb2ba",
    leafEdge: "#5e636d",
    shadow: "#1b1d22",
  },
  gold: {
    paper: ["#fffdf6", "#fbf1d8", "#efdba9"],
    metal: ["#85580f", "#f7d97d", "#bd8c24", "#fff4b8", "#a4761c", "#eecb68", "#85580f"],
    satin: ["#b2801c", "#f1ce66", "#fff3b4", "#dcae3d", "#a47617"],
    ink: "#5b3819",
    boxTop: "#fffdf8", boxLeft: "#f3ecdc", boxRight: "#e3d9c1", boxEdge: "#c9ba94",
    leafEdge: "#8b5c13",
    shadow: "#3b2406",
  },
};

const EDITIONS = { silver: "silver", gold: "gold" };

const f = (n) => Math.round(n * 100) / 100;

// A four-pointed sparkle
const sparkle = (x, y, r) => {
  const k = r * 0.14;
  return `M${f(x)} ${f(y - r)} Q${f(x + k)} ${f(y - k)} ${f(x + r)} ${f(y)} Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + r)} Q${f(x - k)} ${f(y + k)} ${f(x - r)} ${f(y)} Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - r)} Z`;
};

// A leaf that points "up" from (0,0). Place it with translate + rotate.
const leafPath = (len, wid) =>
  `M0 0 C${f(wid * 0.62)} ${f(-len * 0.18)} ${f(wid * 0.6)} ${f(-len * 0.72)} 0 ${f(-len)} C${f(-wid * 0.6)} ${f(-len * 0.72)} ${f(-wid * 0.62)} ${f(-len * 0.18)} 0 0 Z`;

// Point and direction on a cubic curve
function cubic(p, t) {
  const [a, b, c, d] = p;
  const u = 1 - t;
  const x = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0];
  const y = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1];
  const dx = 3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]);
  const dy = 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI + 90 }; // +90: a leaf points up at angle 0
}

// A branch: a thin stem with leaves in pairs along it and one leaf at the tip
function branch(points, count, maxLen, minLen, spread = 48) {
  const [a, b, c, d] = points;
  let out = `<path d="M${a} C${b} ${c} ${d}" fill="none" stroke="url(#stem)" stroke-width="5" stroke-linecap="round"/>`;
  for (let i = 0; i < count; i++) {
    const t = 0.14 + (0.8 * i) / Math.max(1, count - 1);
    const s = cubic(points, t);
    const k = Math.sin(Math.PI * (0.25 + 0.75 * (1 - i / count))); // bigger in the middle, small at the end
    const len = minLen + (maxLen - minLen) * (1 - i / count) * (0.7 + 0.3 * k);
    const side = i % 2 === 0 ? -1 : 1;
    out += `<g transform="translate(${f(s.x)} ${f(s.y)}) rotate(${f(s.angle + side * spread)})"><use href="#leaf" transform="scale(${f(len / 100)})"/></g>`;
  }
  const tip = cubic(points, 1);
  out += `<g transform="translate(${f(tip.x)} ${f(tip.y)}) rotate(${f(tip.angle)})"><use href="#leaf" transform="scale(${f(minLen / 100)})"/></g>`;
  return out;
}

function cardSvg(name, size = ART_PX) {
  const t = THEMES[EDITIONS[name] || name];
  if (!t) throw new Error("Unknown card design: " + name);
  const T = TRIM_PX;
  const mid = T / 2;
  const stops = [0, 0.18, 0.34, 0.5, 0.66, 0.82, 1].map((o, i) => `<stop offset="${o}" stop-color="${t.metal[i]}"/>`).join("");
  const satStops = [0, 0.28, 0.5, 0.74, 1].map((o, i) => `<stop offset="${o}" stop-color="${t.satin[i]}"/>`).join("");

  // ---- the QR corner marks: a perfect square around the white square the server draws
  const gap = 30, arm = 92;
  const bx0 = (T - PLATE_PX.size) / 2 - gap, bx1 = bx0 + PLATE_PX.size + 2 * gap;
  const by0 = PLATE_PX.top - gap, by1 = by0 + PLATE_PX.size + 2 * gap;
  const corner = (x, y, dx, dy) => `M${x + dx * arm} ${y} H${x} V${y + dy * arm}`;
  const marks = [corner(bx0, by0, 1, 1), corner(bx1, by0, -1, 1), corner(bx0, by1, 1, -1), corner(bx1, by1, -1, -1)].join(" ");

  // ---- ribbon band across the top-left corner (drawn in the bow's own coordinates, see below)
  const K = [275, 225]; // the knot
  const dir = [0.788, -0.616], nor = [0.616, 0.788], half = 50;
  const at = (s, w) => `${f(K[0] + dir[0] * s + nor[0] * w)} ${f(K[1] + dir[1] * s + nor[1] * w)}`;
  const band = `M${at(1100, -half)} L${at(1100, half)} L${at(-800, half)} L${at(-800, -half)} Z`;

  // ---- a bow, used large in the corner and small on the gift box
  const bow = `
    <path d="M258 232 C225 170 140 130 85 150 C40 168 28 225 55 255 C90 290 200 277 258 247 Z" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
    <path d="M236 234 C207 196 140 168 96 184 C70 194 68 226 92 241 C128 257 196 254 236 240 Z" fill="url(#hole)"/>
    <path d="M62 188 C95 160 160 150 216 188" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>
    <path d="M292 208 C262 150 274 70 318 28 C355 0 412 6 446 46 C472 80 462 128 426 152 C386 180 336 202 292 218 Z" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
    <path d="M320 182 C301 142 306 92 336 56 C361 40 396 48 413 76 C426 100 413 126 386 141 C361 156 337 172 320 182 Z" fill="url(#hole)"/>
    <path d="M332 30 C372 14 420 32 438 70" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>
    <path d="M318 214 C380 196 456 206 530 232 L492 257 L505 314 C438 298 372 263 322 246 Z" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
    <path d="M322 246 C372 263 438 298 505 314 L492 270 C430 270 366 252 322 232 Z" fill="#000" fill-opacity=".14"/>
    <path d="M338 222 C396 210 456 218 506 236" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
    <path d="M246 262 C228 336 164 404 84 446 L132 466 L106 500 C196 466 276 346 296 270 Z" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
    <path d="M296 270 C276 346 196 466 106 500 L150 480 C220 420 270 340 270 272 Z" fill="#000" fill-opacity=".16"/>
    <path d="M262 290 C240 350 190 410 134 452" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
    <rect x="238" y="190" width="76" height="76" rx="28" transform="rotate(-12 276 228)" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
    <path d="M252 206 C250 226 252 244 258 258" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"/>`;

  // ---- the heart tag
  const heart = "M0 22 C-34 -2 -34 -34 -14 -38 C-4 -40 0 -32 0 -28 C0 -32 4 -40 14 -38 C34 -34 34 -2 0 22 Z";
  const tag = `
    <g transform="translate(161 689) rotate(-8)">
      <path d="M-50 -145 L50 -145 L85 -108 L85 145 L-85 145 L-85 -108 Z" fill="${t.boxTop}" stroke="url(#satEdge)" stroke-width="3" filter="url(#lift)"/>
      <path d="M-42 -135 L42 -135 L75 -102 L75 135 L-75 135 L-75 -102 Z" fill="none" stroke="url(#satEdge)" stroke-width="2"/>
      <circle cx="0" cy="-116" r="13" fill="${t.paper[1]}" stroke="url(#satEdge)" stroke-width="4"/>
      <g transform="translate(0 28) scale(1.5)"><path d="${heart}" fill="none" stroke="${t.ink}" stroke-width="3.6" stroke-linejoin="round"/></g>
    </g>
    <path d="M168 506 C128 524 124 556 146 566 M158 508 C112 534 134 574 150 573" fill="none" stroke="url(#satEdge)" stroke-width="3.2" stroke-linecap="round"/>`;

  // ---- gift box (local coordinates, about 300 x 310)
  const box = `
    <ellipse cx="160" cy="302" rx="150" ry="22" fill="${t.shadow}" fill-opacity=".18" filter="url(#blur)"/>
    <path d="M20 120 L160 78 L290 118 L150 160 Z" fill="${t.boxTop}" stroke="${t.boxEdge}" stroke-width="2"/>
    <path d="M20 120 L150 160 L150 300 L22 258 Z" fill="${t.boxLeft}" stroke="${t.boxEdge}" stroke-width="2"/>
    <path d="M150 160 L290 118 L288 255 L150 300 Z" fill="${t.boxRight}" stroke="${t.boxEdge}" stroke-width="2"/>
    <path d="M70 135.4 L100 144.6 L100 283.6 L70 273.8 Z" fill="url(#sat)"/>
    <path d="M200 145 L230 136 L230 273.9 L200 283.7 Z" fill="url(#sat)"/>
    <path d="M70 135.4 L100 144.6 L240 102.6 L210 93.4 Z" fill="url(#sat)"/>
    <path d="M200 145 L230 136 L100 95 L70 104 Z" fill="url(#sat)"/>
    <path d="M70 135.4 L70 273.8 M200 145 L200 283.7" stroke="#000" stroke-opacity=".14" stroke-width="2" fill="none"/>
    <g transform="translate(156 112) scale(.4) translate(-275 -225)">${bow}</g>`;

  // ---- sprigs of leaves
  const sprigTR = branch([[1032, 66], [1128, 84], [1252, 168], [1320, 350]], 8, 150, 62);
  const sprigBL = branch([[88, 1268], [112, 1162], [150, 1066], [222, 982]], 7, 150, 62, 46) +
    branch([[88, 1268], [176, 1226], [300, 1192], [452, 1222]], 6, 138, 60, 46);

  const dots = [[1020, 110, 5], [1085, 40, 4], [140, 1000, 5], [470, 1275, 5], [520, 1295, 3.5], [60, 960, 3.5]];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-BLEED_PX} ${-BLEED_PX} ${ART_PX} ${ART_PX}">
  <defs>
    <linearGradient id="metalH" gradientUnits="userSpaceOnUse" x1="200" y1="0" x2="${T - 200}" y2="0">${stops}</linearGradient>
    <linearGradient id="sat" x1="0" y1="0" x2="1" y2="1">${satStops}</linearGradient>
    <linearGradient id="satEdge" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <linearGradient id="stem" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <linearGradient id="hole" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.metal[0]}" stop-opacity=".62"/><stop offset="1" stop-color="${t.metal[0]}" stop-opacity=".16"/>
    </linearGradient>
    <linearGradient id="bandG" gradientUnits="userSpaceOnUse" x1="${f(K[0] - nor[0] * half)}" y1="${f(K[1] - nor[1] * half)}" x2="${f(K[0] + nor[0] * half)}" y2="${f(K[1] + nor[1] * half)}">${satStops}</linearGradient>
    <radialGradient id="paper" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${T * 0.52}" r="${T * 0.78}">
      <stop offset="0" stop-color="${t.paper[0]}"/><stop offset="0.55" stop-color="${t.paper[1]}"/><stop offset="1" stop-color="${t.paper[2]}"/>
    </radialGradient>
    <radialGradient id="spot" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${PLATE_PX.top + PLATE_PX.size / 2}" r="${PLATE_PX.size * 1.05}">
      <stop offset="0.55" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="leafG" x1="0" y1="1" x2="1" y2="0">${stops}</linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.5 0"/>
    </filter>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="4" dy="9" stdDeviation="8" flood-color="${t.shadow}" flood-opacity=".32"/></filter>
    <filter id="blur" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
    <g id="leaf">
      <path d="${leafPath(100, 40)}" fill="url(#leafG)" stroke="${t.leafEdge}" stroke-width="1.6" stroke-opacity=".7"/>
      <path d="M0 0 C25 -18 24 -72 0 -100 Z" fill="#000" fill-opacity=".13"/>
      <path d="M0 -4 L0 -88" stroke="${t.leafEdge}" stroke-width="1.8" stroke-opacity=".75" fill="none"/>
    </g>
  </defs>

  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#paper)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#spot)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" filter="url(#grain)" style="mix-blend-mode:soft-light" opacity=".55"/>

  <rect x="64" y="64" width="${T - 128}" height="${T - 128}" fill="none" stroke="url(#metalH)" stroke-width="5"/>

  ${sprigTR}
  ${sprigBL}

  <path d="M690 1430 C790 1336 910 1272 1052 1216 L1082 1272 C996 1306 936 1346 886 1430 Z" fill="url(#sat)" stroke="url(#satEdge)" stroke-width="2.5"/>
  <path d="M760 1388 C840 1330 940 1284 1052 1240" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>

  <g transform="translate(1030 992) scale(.93)" filter="url(#lift)">${box}</g>

  <g transform="matrix(.956 0 0 .956 0 -19)" filter="url(#lift)">
    <path d="${band}" fill="url(#bandG)" stroke="url(#satEdge)" stroke-width="2.5"/>
    ${bow}
  </g>
  <g transform="matrix(.956 0 0 .956 0 -19)">${tag}</g>

  <g stroke="${t.ink}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M598 156 H752 V190 H598 Z M610 190 H740 V262 H610 Z M668 156 V262 M682 156 V262"/>
    <path d="M675 156 C640 156 622 124 640 112 C662 100 676 134 675 156 C674 134 688 100 710 112 C728 124 710 156 675 156"/>
  </g>
  <path d="${sparkle(520, 214, 26)} ${sparkle(832, 214, 26)}" fill="${t.ink}"/>
  <path d="${sparkle(490, 252, 11)} ${sparkle(862, 252, 11)}" fill="${t.ink}"/>
  <path d="${dots.map(([x, y, r]) => sparkle(x, y, r * 2.4)).join(" ")}" fill="url(#metalH)"/>

  <text x="${mid}" y="388" text-anchor="middle" font-family="'Alex Brush', cursive" font-size="${TEXT_SIZE}" fill="${t.ink}" stroke="${t.ink}" stroke-width="1.6" stroke-linejoin="round">${TEXT}</text>

  <path d="M420 452 H628 M722 452 H930" stroke="${t.ink}" stroke-width="4.5" stroke-linecap="round"/>
  <g transform="translate(${mid} 452) scale(1.15)"><path d="M0 18 C-30 -4 -30 -32 -13 -35 C-4 -37 0 -29 0 -25 C0 -29 4 -37 13 -35 C30 -32 30 -4 0 18 Z" fill="${t.ink}"/></g>

  <path d="${marks}" fill="none" stroke="${t.ink}" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter"/>
</svg>`;
}

module.exports = { THEMES, EDITIONS, cardSvg };
