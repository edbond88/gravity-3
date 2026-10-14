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
    const step = last ? Math.hypot(b.x - last.x, b.y - last.y) : 0;
    if (!last || step > TRAIL_MIN_DIST || t - last.t > 0.1) {
      // d: distance travelled, so a tail's texture stays put where it was left
      const d = last ? last.d + step : 0;
      tr.push({ x: b.x, y: b.y, t, d, v: Math.hypot(b.vx, b.vy), e: escapeRatio(list, list.indexOf(b), softening) });
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

// A star held by the pointer glides in a straight line to where the pointer
// is now over the frame; the others feel its pull, but it ignores theirs.
const THROW_SMOOTHING = 0.08; // s — the throw is the pointer's speed over about this long

function advance(years) {
  if (years <= 0) return;
  const dustStep = Math.max(DUST_STEP, years / DUST_MAX_STEPS);
  const held = drag && {
    body: drag.body, x0: drag.body.x, y0: drag.body.y,
    vx: (drag.x - drag.body.x) / years, vy: (drag.y - drag.body.y) / years,
  };
  if (held) {
    const k = 1 - Math.exp(-years / rate / THROW_SMOOTHING);
    drag.vx += (held.vx - drag.vx) * k;
    drag.vy += (held.vy - drag.vy) * k;
  }
  let left = years;
  let steps = 0;
  while (left > 0 && steps < MAX_STEPS_PER_FRAME) {
    const dt = Math.min(adaptiveDt(bodies, softening), left);
    step(bodies, dt, softening);
    simTime += dt;
    left -= dt;
    steps++;
    if (held) {
      const b = held.body, f = years - left;
      b.x = held.x0 + held.vx * f; b.y = held.y0 + held.vy * f;
      b.vx = held.vx; b.vy = held.vy;
      computeAccelerations(bodies, softening);
    }
    recordTrails(bodies, simTime);
    if (showDust) advanceDust(bodies, dt, dustStep);
    detectEncounters();
  }
  pruneTrails(bodies, simTime);
}

// Close encounters → a fly-by sound at the moment of closest approach. After a
// pass the pair re-arms once it has moved apart to REARM_FACTOR × that distance.
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
      sound.flyby(intensity, pan, pitch);
      spawnBurst(a, b, (a.x * a.mass + b.x * b.mass) / (a.mass + b.mass), (a.y * a.mass + b.y * b.mass) / (a.mass + b.mass), intensity);
    }
    e.falling = r < e.prev;
    e.prev = r;
  });
}

// Each star drones: heavier stars lower — an open chord of A1, E2, A2 — and
// every voice brightens and swells as its star speeds up.
const HUM_NOTES = [55, 82.41, 110];
let humSpeed = 0; // the stars' average speed, followed slowly

function updateHum(realDt) {
  if (!sound.enabled || !bodies.length) return;
  const avg = bodies.reduce((s, b) => s + Math.hypot(b.vx, b.vy), 0) / bodies.length;
  humSpeed = humSpeed ? humSpeed + (avg - humSpeed) * (1 - Math.exp(-realDt / 4)) : avg;
  const byMass = bodies.map((b, i) => i).sort((i, j) => bodies[j].mass - bodies[i].mass);
  const stars = bodies.map((b, i) => ({
    root: HUM_NOTES[byMass.indexOf(i)],
    speed: Math.hypot(b.vx, b.vy) / (humSpeed || 1),
    pan: Math.max(-1, Math.min(1, (toScreenX(b.x) / width) * 2 - 1)) * 0.7,
  }));
  sound.hum(stars, !paused && !restarting);
}

function reset() {
  drag = null;
  camera.ox = camera.oy = 0;
  bodies = createBodies();
  energy0 = totalEnergy(bodies, softening);
  resetEncounters();
  bursts = [];
  resetDust();
  simTime = 0;
  humSpeed = 0;
  camera.scale = 0;
  hudTimer = 0;
}

// The stars fade out, the new system is set up while nothing is visible, and
// fades in. The renderer eases its opacity towards `fadeTarget`.
const FADE_TIME = 0.9; // s
let fadeTarget = 1;

function restart() {
  if (restarting) return;
  restarting = true;
  fadeTarget = 0;
  setTimeout(() => {
    reset();
    fadeTarget = 1;
    restarting = false;
  }, FADE_TIME * 1000);
}
