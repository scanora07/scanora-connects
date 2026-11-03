"use strict";

// The two gift-card designs, drawn as SVG: a GOLD card and a SILVER card. Each is a matte, soft-touch
// black card (flat, fine grain, no shine) with GLOSSY foil on top: the greeting on one line, a thin
// border and a polished frame around the QR code. That is how luxury gift cards are finished:
// matte stock with gloss foil, so the foil catches the light and the rest stays calm.
//
// There is no brand name on the cards, so a shop can sell them as they are.
// build.js turns these into the print-ready images the server places on the sheets.
//
// Coordinates are in pixels of the finished card (2.25 in at 600 dpi = 1350). The artwork reaches
// BLEED_PX past every edge, so the SVG's viewBox starts at -BLEED_PX. All corners are sharp squares.
//
// The white square that holds the QR code is NOT drawn here: the server draws it (and the QR code)
// as sharp vector shapes. This file only leaves the right space for it and draws the foil frame
// around it, using the same numbers (PLATE_PX), so the two always line up.
//
// Printed lines are never thinner than 4 px (0.17 mm), the finest a press holds reliably.

const { TRIM_PX, BLEED_PX, ART_PX, PLATE_PX } = require("../server/layout");

const TEXT = "A surprise for you";

const THEMES = {
  gold: {
    matte: ["#2a2012", "#17110a", "#0a0704"],   // centre, middle, edge of the soft-touch card
    // foil, left to right: shadow, light, mid, hot spot, mid, light, shadow
    foil: ["#7a561a", "#f3d98c", "#c39532", "#fff6c8", "#b98a2a", "#ecd17b", "#7a561a"],
    deep: "#050301",
  },
  silver: {
    matte: ["#272a30", "#15171b", "#08090b"],
    foil: ["#6d727b", "#f1f3f6", "#a8adb5", "#ffffff", "#9a9fa8", "#e4e7ea", "#6d727b"],
    deep: "#020203",
  },
};

const EDITIONS = { silver: "silver", gold: "gold" };

const f = (n) => Math.round(n * 100) / 100;

function cardSvg(name, size = ART_PX) {
  const t = THEMES[EDITIONS[name] || name];
  if (!t) throw new Error("Unknown card design: " + name);
  const T = TRIM_PX;
  const mid = T / 2;
  const at = [0, 0.16, 0.3, 0.46, 0.62, 0.8, 1];
  const stops = at.map((o, i) => `<stop offset="${o}" stop-color="${t.foil[i]}"/>`).join("");

  // ---- the QR frame: a glossy foil band, then a dark recess, then (drawn by the server) the white square
  const px = (T - PLATE_PX.size) / 2;
  const py = PLATE_PX.top;
  const s = PLATE_PX.size;
  const band = 24, recess = 10;
  const sq = (grow) => `x="${px - grow}" y="${py - grow}" width="${s + 2 * grow}" height="${s + 2 * grow}"`;

  // ---- the greeting: one line of glossy foil
  const textY = 336;
  const textAttrs = `x="${mid}" y="${textY}" text-anchor="middle" font-family="'Pinyon Script', cursive" font-size="156"`;

  // ---- the divider under it: a line, a diamond and a line
  const dy = 444;
  const diamond = (x, y, r) => `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;

  // ---- the border, with a small foil square in each corner
  const o = 66, i = 96, stud = 16;
  const studs = [[i, i], [T - i, i], [i, T - i], [T - i, T - i]].map(([x, y]) => `<rect x="${x - stud / 2}" y="${y - stud / 2}" width="${stud}" height="${stud}"/>`).join("");

  // ---- tone-on-tone lattice printed in a faint gloss on the matte: only visible when the card is tilted
  const lattice = 54;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-BLEED_PX} ${-BLEED_PX} ${ART_PX} ${ART_PX}">
  <defs>
    <linearGradient id="foil" gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="${T - 150}" y2="0">${stops}</linearGradient>
    <linearGradient id="foilD" gradientUnits="userSpaceOnUse" x1="${px - band}" y1="${py - band}" x2="${px + s + band}" y2="${py + s + band}">${stops}</linearGradient>
    <linearGradient id="foilB" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${T}" y2="${T}">${stops}</linearGradient>
    <!-- gloss: a bright band along the top of each foil letter, as if a lamp shone from above -->
    <linearGradient id="gloss" gradientUnits="userSpaceOnUse" x1="0" y1="${textY - 120}" x2="0" y2="${textY + 70}">
      <stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".42" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".28"/>
    </linearGradient>
    <linearGradient id="glossF" gradientUnits="userSpaceOnUse" x1="0" y1="${py - band - recess}" x2="0" y2="${py + s + band + recess}">
      <stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".12" stop-color="#fff" stop-opacity=".05"/><stop offset=".9" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".34"/>
    </linearGradient>
    <radialGradient id="matte" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${T * 0.42}" r="${T * 0.85}">
      <stop offset="0" stop-color="${t.matte[0]}"/><stop offset=".55" stop-color="${t.matte[1]}"/><stop offset="1" stop-color="${t.matte[2]}"/>
    </radialGradient>
    <!-- the faint soft-touch sheen: a very wide, very soft diagonal lift in the matte -->
    <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="${-BLEED_PX}" y1="${T}" x2="${T}" y2="${-BLEED_PX}">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".07"/>
      <stop offset=".64" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <pattern id="lat" width="${lattice}" height="${lattice}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0 H${lattice} M0 0 V${lattice}" stroke="#fff" stroke-opacity=".03" stroke-width="4" fill="none"/>
    </pattern>
    <!-- matte grain: fine, even, soft; the opposite of brushed streaks -->
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="5"/>
      <feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/>
    </filter>
    <filter id="emboss" x="-8%" y="-30%" width="116%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="4.5" flood-color="${t.deep}" flood-opacity=".75"/>
    </filter>
    <filter id="lift" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="${t.deep}" flood-opacity=".7"/></filter>
  </defs>

  <!-- the matte card -->
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#matte)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#lat)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#sheen)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" filter="url(#grain)" style="mix-blend-mode:soft-light" opacity=".6"/>

  <!-- glossy foil: the border -->
  <g filter="url(#emboss)">
    <rect x="${o}" y="${o}" width="${T - 2 * o}" height="${T - 2 * o}" fill="none" stroke="url(#foilB)" stroke-width="7"/>
    <rect x="${i - 14}" y="${i - 14}" width="${T - 2 * (i - 14)}" height="${T - 2 * (i - 14)}" fill="none" stroke="url(#foilB)" stroke-width="4" stroke-opacity=".9"/>
    <g fill="url(#foilB)">${studs}</g>
  </g>

  <!-- glossy foil: the greeting -->
  <g filter="url(#emboss)">
    <text ${textAttrs} fill="url(#foil)">${TEXT}</text>
  </g>
  <text ${textAttrs} fill="url(#gloss)">${TEXT}</text>

  <!-- glossy foil: the divider -->
  <g filter="url(#emboss)" fill="url(#foil)" stroke="none">
    <rect x="${mid - 330}" y="${dy - 2.5}" width="262" height="5"/>
    <rect x="${mid + 68}" y="${dy - 2.5}" width="262" height="5"/>
    <path d="${diamond(mid, dy, 18)}"/>
    <path d="${diamond(mid - 44, dy, 6)} ${diamond(mid + 44, dy, 6)}"/>
  </g>

  <!-- glossy foil: the frame around the QR code; the server draws the white square exactly on top of the dark recess -->
  <g filter="url(#lift)"><rect ${sq(band + recess)} fill="url(#foilD)"/></g>
  <rect ${sq(band + recess)} fill="url(#glossF)"/>
  <rect ${sq(band + recess - 2)} fill="none" stroke="#fff" stroke-width="4" stroke-opacity=".55" transform="translate(-1 -1)"/>
  <rect ${sq(recess)} fill="${t.deep}" fill-opacity=".92"/>
  <rect ${sq(recess)} fill="none" stroke="#000" stroke-width="4" stroke-opacity=".5"/>
</svg>`;
}

module.exports = { THEMES, EDITIONS, cardSvg };
