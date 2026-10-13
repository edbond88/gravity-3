'use strict';

// ---------------------------------------------------------------------------
// Simulation state: the bodies, advancing them in time, close encounters and
// restarts.
// ---------------------------------------------------------------------------
const MAX_STEPS_PER_FRAME = 20000;
const BASE_RATE = 1;             // simulated years per real second at 1×

const TRAIL_DURATION = 3;        // years of history kept in a trail (chaos)
const TRAIL_MAX_DURATION = 12;   // presets show one full period, up to this
const TRAIL_MIN_DIST = 0.015;    // AU between stored trail points
const TRAIL_MAX_POINTS = 8000;

let bodies = [];
let simTime = 0;
let paused = false;
let rate = BASE_RATE;
let restarting = false;
let masses = [1, 1, 1];
let preset = 'chaos';
let softening = SOFTENING;
let trailDuration = TRAIL_DURATION;

function createBodies() {
  const list = PRESETS[preset].create(masses);
  softening = preset === 'chaos' ? SOFTENING : PRESET_SOFTENING;
  trailDuration = list.period ? Math.min(list.period, TRAIL_MAX_DURATION) : TRAIL_DURATION;
  computeAccelerations(list, softening);
  return list;
}

function recordTrails(list, t) {
  for (const b of list) {
    const tr = b.trail;
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(b.x - last.x, b.y - last.y) > TRAIL_MIN_DIST || t - last.t > 0.1) {
      tr.push({ x: b.x, y: b.y, t, v: Math.hypot(b.vx, b.vy), e: escapeRatio(list, list.indexOf(b), softening) });
      if (tr.length > TRAIL_MAX_POINTS) tr.shift();
    }
  }
}

function pruneTrails(list, t) {
  for (const b of list) {
    let n = 0;
    while (n < b.trail.length - 1 && t - b.trail[n].t > trailDuration) n++;
    if (n) b.trail.splice(0, n);
  }
}

function advance(years) {
  let left = years;
  let steps = 0;
  while (left > 0 && steps < MAX_STEPS_PER_FRAME) {
    const dt = Math.min(adaptiveDt(bodies, softening), left);
    step(bodies, dt, softening);
    simTime += dt;
    left -= dt;
    steps++;
    recordTrails(bodies, simTime);
    detectEncounters();
  }
  pruneTrails(bodies, simTime);
}

// Close encounters → bass thump at the moment of closest approach. After a
// thump the pair re-arms once it has moved apart to REARM_FACTOR × that distance.
const ENCOUNTER_NEAR = 1.2;  // AU — closest approach must be below this
const REARM_FACTOR = 1.5;
const PAIRS = [[0, 1], [1, 2], [0, 2]];
let encounters = [];

function resetEncounters() {
  encounters = PAIRS.map(() => ({ armed: true, falling: false, prev: Infinity, min: 0 }));
}

function detectEncounters() {
  PAIRS.forEach(([i, j], k) => {
    const a = bodies[i], b = bodies[j], e = encounters[k];
    const r = Math.hypot(a.x - b.x, a.y - b.y);
    if (r > e.min * REARM_FACTOR) e.armed = true;
    if (e.armed && e.falling && r > e.prev && e.prev < ENCOUNTER_NEAR) {
      e.armed = false;
      e.min = e.prev;
      const closeness = 1 - e.prev / ENCOUNTER_NEAR;
      const intensity = 0.15 + 0.85 * closeness;
      const x = toScreenX((a.x * a.mass + b.x * b.mass) / (a.mass + b.mass));
      const pan = Math.max(-1, Math.min(1, (x / width) * 2 - 1)) * 0.7;
      const pitch = Math.sqrt(2.4 / (a.mass + b.mass)); // heavier pair → lower
      sound.thump(intensity, pan, pitch);
      spawnBurst(a, b, (a.x * a.mass + b.x * b.mass) / (a.mass + b.mass), (a.y * a.mass + b.y * b.mass) / (a.mass + b.mass), intensity);
    }
    e.falling = r < e.prev;
    e.prev = r;
  });
}

function reset() {
  drag = null;
  camera.ox = camera.oy = 0;
  bodies = createBodies();
  energy0 = totalEnergy(bodies, softening);
  resetEncounters();
  bursts = [];
  simTime = 0;
  camera.scale = 0;
  hudTimer = 0;
}

function restart() {
  if (restarting) return;
  restarting = true;
  canvas.style.opacity = '0';
  setTimeout(() => {
    reset();
    canvas.style.opacity = '1';
    restarting = false;
  }, 900);
}
