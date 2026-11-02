"use strict";

// The two card designs, drawn as SVG: a silver card and a gold card on a black background.
// There is no brand name on the cards, only "A surprise for you", so a shop can sell them as they are.
// build.js turns these into the print-ready images the server places on the sheets.
//
// Coordinates are in pixels of the finished card (2.25 in at 600 dpi = 1350). The artwork reaches
// BLEED_PX past every edge, so the SVG's viewBox starts at -BLEED_PX.
//
// The white plate that holds the QR code is NOT drawn here: the server draws it (and the QR code)
// as sharp vector shapes. This file only leaves the right space for it, using the same numbers.

const { TRIM_PX, BLEED_PX, ART_PX, PLATE_PX } = require("../server/layout");

const TEXT = "A surprise for you";

const EDITIONS = {
  silver: {
    // light sweeps across the metal: shadow, bright, mid, white hot spot, mid, bright, shadow
    metal: ["#6f7680", "#f1f4f8", "#a3abb6", "#ffffff", "#8d95a1", "#e6eaef", "#6f7680"],
    glow: "#aebbd0",
  },
  gold: {
    metal: ["#6a4a0e", "#f2d578", "#b3831f", "#fff6c4", "#9f7320", "#eecb66", "#6a4a0e"],
    glow: "#d4ad52",
  },
};

// A frame with cut corners, the art-deco look of premium gift boxes
function chamfered(inset, cut) {
  const a = inset, b = TRIM_PX - inset;
  return `M${a + cut} ${a} H${b - cut} L${b} ${a + cut} V${b - cut} L${b - cut} ${b} H${a + cut} L${a} ${b - cut} V${a + cut} Z`;
}

const diamond = (x, y, r) => `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;

function cardSvg(edition, size = ART_PX) {
  const e = EDITIONS[edition];
  if (!e) throw new Error("Unknown edition: " + edition);
  const T = TRIM_PX;
  const mid = T / 2;
  const stops = [0, 0.18, 0.34, 0.5, 0.66, 0.82, 1]
    .map((o, i) => `<stop offset="${o}" stop-color="${e.metal[i]}"/>`)
    .join("");

  // Four corner brackets around the QR plate, like a camera viewfinder
  const plateX = (T - PLATE_PX.size) / 2;
  const gap = 30;
  const arm = 96;
  const x0 = plateX - gap, x1 = plateX + PLATE_PX.size + gap;
  const y0 = PLATE_PX.top - gap, y1 = PLATE_PX.top + PLATE_PX.size + gap;
  const bracket = (x, y, dx, dy) => `M${x + dx * arm} ${y} H${x} V${y + dy * arm}`;
  const brackets = [bracket(x0, y0, 1, 1), bracket(x1, y0, -1, 1), bracket(x0, y1, 1, -1), bracket(x1, y1, -1, -1)].join(" ");

  const cuts = [diamond(58 + 44, 58, 13), diamond(T - 58 - 44, 58, 13), diamond(58 + 44, T - 58, 13), diamond(T - 58 - 44, T - 58, 13)].join(" ");

  const titleY = 232;
  const rule = 286; // the line under the title
  const foot = 1182; // the ornament under the QR code

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-BLEED_PX} ${-BLEED_PX} ${ART_PX} ${ART_PX}">
  <defs>
    <linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${T}" y2="${T}">${stops}</linearGradient>
    <linearGradient id="metalH" gradientUnits="userSpaceOnUse" x1="120" y1="0" x2="${T - 120}" y2="0">${stops}</linearGradient>
    <radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${T * 0.5}" r="${T * 0.8}">
      <stop offset="0" stop-color="#1e1e23"/><stop offset="0.5" stop-color="#0e0e11"/><stop offset="1" stop-color="#030304"/>
    </radialGradient>
    <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${PLATE_PX.top + PLATE_PX.size / 2}" r="${PLATE_PX.size * 0.95}">
      <stop offset="0" stop-color="${e.glow}" stop-opacity="0.24"/><stop offset="1" stop-color="${e.glow}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0.5H14" stroke="#fff" stroke-opacity="0.04" stroke-width="1"/>
    </pattern>
    <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${T}" y2="${T}">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.34" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.085"/>
      <stop offset="0.66" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#bg)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#weave)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#glow)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#sheen)"/>

  <path d="${chamfered(58, 44)}" fill="none" stroke="url(#metal)" stroke-width="5.5" stroke-linejoin="miter"/>
  <path d="${chamfered(86, 30)}" fill="none" stroke="url(#metal)" stroke-width="1.8" stroke-opacity="0.85" stroke-linejoin="miter"/>
  <path d="${cuts}" fill="url(#metal)"/>

  <text x="${mid + 3}" y="${titleY + 4}" text-anchor="middle" font-family="'Dancing Script', cursive" font-weight="700" font-size="116" fill="#000" fill-opacity="0.65">${TEXT}</text>
  <text x="${mid}" y="${titleY}" text-anchor="middle" font-family="'Dancing Script', cursive" font-weight="700" font-size="116" fill="url(#metalH)">${TEXT}</text>

  <path d="M250 ${rule} H610 M740 ${rule} H1100" stroke="url(#metalH)" stroke-width="2.2" stroke-opacity="0.85"/>
  <path d="${diamond(mid, rule, 11)}" fill="url(#metalH)"/>
  <path d="${diamond(650, rule, 4)} ${diamond(700, rule, 4)}" fill="url(#metalH)" fill-opacity="0.8"/>

  <path d="${brackets}" fill="none" stroke="url(#metal)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>

  <path d="M330 ${foot} H610 M740 ${foot} H1020" stroke="url(#metalH)" stroke-width="2.2" stroke-opacity="0.85"/>
  <path d="${diamond(mid, foot, 11)}" fill="url(#metalH)"/>
  <path d="${diamond(650, foot, 4)} ${diamond(700, foot, 4)}" fill="url(#metalH)" fill-opacity="0.8"/>
</svg>`;
}

module.exports = { EDITIONS, cardSvg };
