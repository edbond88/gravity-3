'use strict';

// ---------------------------------------------------------------------------
// Colours shared by the renderer and the bursts, as [r, g, b] in 0…255.
// ---------------------------------------------------------------------------
const mix = (c1, c2, f) => c1.map((v, i) => Math.round(v + (c2[i] - v) * f));
const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const COLOR_RGB = Object.fromEntries(COLORS.map((hex) => [hex, toRgb(hex)]));
const WHITE = [255, 250, 240];

// Energy colouring: bound → blue, at escape speed → white, escaping → orange.
// A little of the star's own colour stays in, so trails can still be told apart.
const BOUND_RGB = [80, 130, 255];
const ESCAPE_RGB = [255, 125, 50];

function energyColor(level, base) {
  const c = level < 0.5 ? mix(BOUND_RGB, WHITE, level * 2) : mix(WHITE, ESCAPE_RGB, level * 2 - 1);
  return mix(c, base, 0.2);
}

// Surface colour by mass, like main-sequence stars: light ones burn orange,
// heavy ones blue-white.
const TEMPERATURE = [
  [0.2, [255, 160, 90]],
  [0.6, [255, 205, 150]],
  [1.2, [255, 245, 230]],
  [2.5, [215, 230, 255]],
  [5, [165, 195, 255]],
];

function temperatureColor(mass) {
  const m = Math.max(TEMPERATURE[0][0], Math.min(TEMPERATURE.at(-1)[0], mass));
  let i = 0;
  while (m > TEMPERATURE[i + 1][0]) i++;
  const [m0, c0] = TEMPERATURE[i], [m1, c1] = TEMPERATURE[i + 1];
  return mix(c0, c1, Math.log(m / m0) / Math.log(m1 / m0));
}
