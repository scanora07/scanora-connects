"use strict";

// One place for every measurement of the printed sheet, so the card artwork (design/card.js) and the
// PDF builder (sheet.js) can never disagree about where the QR code goes. Sizes are in inches.

const SHEET = { width: 13, height: 19 };   // the paper the shop prints on
const CARD = 2.25;                          // finished (trimmed) card, square
const GUTTER = 0.1;                         // gap between neighbouring cards, cut away
const BLEED = GUTTER / 2;                   // artwork runs this far past the trim edge, so a slightly
                                            // off cut never shows white paper
const COLS = 5;
const ROWS = 8;
const PER_SHEET = COLS * ROWS;

// Artwork is drawn at 600 dpi. A card plus its bleed on every side is the size of one artwork image.
const DPI = 600;
const ART_PX = Math.round((CARD + 2 * BLEED) * DPI);   // 1410
const TRIM_PX = Math.round(CARD * DPI);                 // 1350
const BLEED_PX = Math.round(BLEED * DPI);               // 30

// The white plate that carries the QR code, in pixels measured from the card's trim corner.
// It is centred left to right. The QR code's own quiet border is part of the plate.
const PLATE_PX = { size: 720, top: 340, radius: 44 };

const gridWidth = COLS * CARD + (COLS - 1) * GUTTER;    // 11.65
const gridHeight = ROWS * CARD + (ROWS - 1) * GUTTER;   // 18.7
const MARGIN = {
  x: (SHEET.width - gridWidth) / 2,                      // 0.675
  y: (SHEET.height - gridHeight) / 2,                    // 0.15
};

module.exports = { SHEET, CARD, GUTTER, BLEED, COLS, ROWS, PER_SHEET, DPI, ART_PX, TRIM_PX, BLEED_PX, PLATE_PX, MARGIN };
