"use strict";

// Every measurement of the printed sheet in one place. All sizes are in inches.
// The part you will most likely change is QR, at the bottom: where the QR code sits on each card.

const SHEET = { width: 13, height: 19 };   // the paper the shop prints on
const CARD = 2.25;                          // finished (trimmed) card, square
const GUTTER = 0.1;                         // gap between neighbouring cards, cut away
const BLEED = GUTTER / 2;                   // the picture is extended this far past every card edge, so a
                                            // slightly off cut never shows white paper
const COLS = 5;
const ROWS = 8;
const PER_SHEET = COLS * ROWS;

const gridWidth = COLS * CARD + (COLS - 1) * GUTTER;    // 11.65
const gridHeight = ROWS * CARD + (ROWS - 1) * GUTTER;   // 18.7
const MARGIN = {
  x: (SHEET.width - gridWidth) / 2,                      // 0.675
  y: (SHEET.height - gridHeight) / 2,                    // 0.15
};

// Where the QR code goes on each card, measured from the card's top-left corner (the trimmed edge).
//   x     distance from the left edge to the left side of the white square
//   y     distance from the top edge to the top of the white square
//   size  width and height of the white square (it is always a perfect square with sharp corners)
// The QR code is drawn inside the white square with a quiet white border, so keep size at 1 or more.
// The picture you put in server/art is shown exactly as it is; this square is drawn on top of it,
// so leave that area of your picture plain and light.
// Example: a square centred left to right is x = (2.25 - size) / 2.
const QR = {
  silver: { x: 0.625, y: 0.93, size: 1 },
  gold:   { x: 0.625, y: 0.93, size: 1 },
};

for (const [name, q] of Object.entries(QR)) {
  const ok = [q.x, q.y, q.size].every(Number.isFinite) && q.size > 0 && q.x >= 0 && q.y >= 0 && q.x + q.size <= CARD && q.y + q.size <= CARD;
  if (!ok) throw new Error("The QR position for the " + name + " card (server/layout.js) must lie inside the " + CARD + " inch card.");
}

module.exports = { SHEET, CARD, GUTTER, BLEED, COLS, ROWS, PER_SHEET, MARGIN, QR };
