"use strict";

// The two gift-card designs, drawn as SVG: a GOLD card (champagne brushed metal) and a SILVER card
// (platinum brushed metal). They are plain, square-cornered metal cards with one engraved greeting,
// a hairline, and a polished metal frame around the QR code. No other decoration and no brand name,
// so a shop can sell them as they are.
//
// build.js turns these into the print-ready images the server places on the sheets.
//
// Coordinates are in pixels of the finished card (2.25 in at 600 dpi = 1350). The artwork reaches
// BLEED_PX past every edge, so the SVG's viewBox starts at -BLEED_PX.
//
// The white square that holds the QR code is NOT drawn here: the server draws it (and the QR code)
// as sharp vector shapes. This file only leaves the right space for it and draws the metal frame
// around it, using the same numbers (PLATE_PX), so the two always line up.
//
// Lines are never thinner than 4 px (0.17 mm), the finest a press prints reliably.

const { TRIM_PX, BLEED_PX, ART_PX, PLATE_PX } = require("../server/layout");

const LINES = ["A SURPRISE", "FOR YOU"];

const THEMES = {
  gold: {
    // brushed metal: shadow, light, mid, hot spot, mid, light, shadow - laid across the card diagonally
    metal: ["#b08f4e", "#e8d39e", "#c6a666", "#f6e9bf", "#c9ab6c", "#ebd8a8", "#a98847"],
    // the polished frame around the QR: the same colours, with much more contrast
    polish: ["#7d5d22", "#f7e8b6", "#b18d44", "#fff8de", "#966f2c", "#ecd391", "#6e5019"],
    ink: "#5a4116",      // engraved lettering
    lip: "#fff3cf",      // the light edge under every engraved stroke
    deep: "#2e1f06",     // the shadow inside every engraved stroke and under the frame
  },
  silver: {
    metal: ["#a3a8b0", "#e4e6ea", "#bcc0c7", "#f6f7f9", "#c0c4cb", "#e6e8eb", "#9a9fa7"],
    polish: ["#6f747c", "#f8f9fb", "#a9aeb6", "#ffffff", "#7e838b", "#e4e7ea", "#62676f"],
    ink: "#2d3138",
    lip: "#ffffff",
    deep: "#0d0f12",
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
  const stops = (colours) => at.map((o, i) => `<stop offset="${o}" stop-color="${colours[i]}"/>`).join("");

  // ---- the QR frame: a polished band, then a dark recess, then (drawn by the server) the white square
  const px = (T - PLATE_PX.size) / 2;
  const py = PLATE_PX.top;
  const s = PLATE_PX.size;
  const band = 26, recess = 10;
  const sq = (grow) => `x="${px - grow}" y="${py - grow}" width="${s + 2 * grow}" height="${s + 2 * grow}"`;

  // ---- engraved lettering: a light lip below-right, a dark shadow above-left, the ink on top
  const engrave = (inner, attrs = "") => `
    <g ${attrs} fill="${t.lip}" stroke="${t.lip}" transform="translate(2.6 3.2)" opacity=".9">${inner}</g>
    <g ${attrs} fill="${t.deep}" stroke="${t.deep}" transform="translate(-1.6 -2)" opacity=".55">${inner}</g>
    <g ${attrs} fill="${t.ink}" stroke="${t.ink}">${inner}</g>`;

  const spacing = 20;
  const title = LINES.map((line, i) => `<text x="${f(mid + spacing / 2)}" y="${i ? 372 : 252}" text-anchor="middle" letter-spacing="${spacing}" font-family="Cinzel, serif" font-weight="600" font-size="${i ? 118 : 118}" stroke="none">${line}</text>`).join("");

  const heartY = 462;
  const divider = `
    <path d="M${mid - 270} ${heartY} H${mid - 44} M${mid + 44} ${heartY} H${mid + 270}" fill="none" stroke-width="4" stroke-linecap="butt"/>
    <g transform="translate(${mid} ${heartY + 4}) scale(1.35)"><path d="M0 18 C-30 -4 -30 -32 -13 -35 C-4 -37 0 -29 0 -25 C0 -29 4 -37 13 -35 C30 -32 30 -4 0 18 Z" stroke="none"/></g>`;

  const inset = 70;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-BLEED_PX} ${-BLEED_PX} ${ART_PX} ${ART_PX}">
  <defs>
    <linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="${-BLEED_PX}" y1="${-BLEED_PX}" x2="${T + BLEED_PX}" y2="${T + BLEED_PX}">${stops(t.metal)}</linearGradient>
    <linearGradient id="polish" gradientUnits="userSpaceOnUse" x1="${px - band}" y1="${py - band}" x2="${px + s + band}" y2="${py + s + band}">${stops(t.polish)}</linearGradient>
    <radialGradient id="vignette" gradientUnits="userSpaceOnUse" cx="${mid}" cy="${mid}" r="${T * 0.78}">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/>
    </radialGradient>
    <linearGradient id="streak" gradientUnits="userSpaceOnUse" x1="${-BLEED_PX}" y1="${T * 0.9}" x2="${T * 0.9}" y2="${-BLEED_PX}">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".34"/>
      <stop offset=".58" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <!-- brushed metal: noise that changes slowly across the card but very fast down it, i.e. long horizontal streaks -->
    <filter id="brushA" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0014 0.42" numOctaves="3" seed="4"/>
      <feColorMatrix type="matrix" values="1.8 0 0 0 -.4  1.8 0 0 0 -.4  1.8 0 0 0 -.4  0 0 0 0 1"/>
    </filter>
    <filter id="brushB" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0006 1.6" numOctaves="2" seed="9"/>
      <feColorMatrix type="matrix" values="1.5 0 0 0 -.25  1.5 0 0 0 -.25  1.5 0 0 0 -.25  0 0 0 0 1"/>
    </filter>
    <filter id="lift" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="${t.deep}" flood-opacity=".42"/></filter>
  </defs>

  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#metal)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" filter="url(#brushA)" style="mix-blend-mode:soft-light" opacity=".62"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" filter="url(#brushB)" style="mix-blend-mode:soft-light" opacity=".3"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#streak)"/>
  <rect x="${-BLEED_PX}" y="${-BLEED_PX}" width="${ART_PX}" height="${ART_PX}" fill="url(#vignette)"/>

  <!-- the fine border, engraved into the metal -->
  ${engrave(`<rect x="${inset}" y="${inset}" width="${T - 2 * inset}" height="${T - 2 * inset}" fill="none" stroke-width="4"/>`)}

  <!-- the greeting -->
  ${engrave(title)}
  ${engrave(divider)}

  <!-- the polished metal frame around the QR code; the server draws the white square exactly on top of the dark recess -->
  <g filter="url(#lift)"><rect ${sq(band + recess)} fill="url(#polish)"/></g>
  <rect ${sq(band + recess)} fill="none" stroke="${t.lip}" stroke-width="4" stroke-opacity=".85" transform="translate(2 2)"/>
  <rect ${sq(recess)} fill="${t.deep}" fill-opacity=".62"/>
  <rect ${sq(recess)} fill="none" stroke="${t.lip}" stroke-width="4" stroke-opacity=".55" transform="translate(-2 -2)"/>
</svg>`;
}

module.exports = { THEMES, EDITIONS, cardSvg };
