'use strict';

// ---------------------------------------------------------------------------
// Dust: a quarter of a million weightless grains blowing through the system
// like a wind, moving in the stars' gravity by the same physics — the stars
// bend it and focus it into wakes, so their pull becomes visible. The grains
// live on the GPU (js/gl/dust.js). This side records where the stars were as simulated
// time passes, so the GPU can move the grains through the same history,
// however many frames it is drawn in.
// ---------------------------------------------------------------------------
const DUST_STEP = 0.004;     // years between snapshots of the stars
const DUST_MAX_STEPS = 6;    // snapshots per frame at most: at high speed they get longer

// queue: what the GPU still has to do, in order — { dt, bodies: [[x, y, m, vx, vy] × 3] }
// to move the grains on, or { shift: [dx, dy, dvx, dvy] } to recentre them;
// reseed: fill the view with fresh wind before the next step.
const dust = { queue: [], clock: 0, reseed: true };

function resetDust() {
  dust.queue = [];
  dust.clock = 0;
  dust.reseed = true;
}

// Called as the simulation advances by dt years; `step` is how long the GPU
// steps should be.
function advanceDust(list, dt, step = DUST_STEP) {
  dust.clock += dt;
  if (dust.clock < step) return;
  dust.queue.push({ dt: dust.clock, bodies: list.map((b) => [b.x, b.y, b.mass, b.vx, b.vy]) });
  dust.clock = 0;
}

// Recentring after a star is dragged moves and slows the whole frame.
function shiftDust(dx, dy, dvx, dvy) {
  dust.queue.push({ shift: [dx, dy, dvx, dvy] });
}
