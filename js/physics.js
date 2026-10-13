'use strict';

// ---------------------------------------------------------------------------
// Physics: Newtonian gravity in AU, years and solar masses (so G = 4π²),
// integrated with velocity Verlet and an adaptive time step. Pure functions of
// the bodies they are given; `eps` is the softening length in AU. No DOM, so the
// tests can load this file in Node.
// ---------------------------------------------------------------------------
const G = 4 * Math.PI * Math.PI;
const AU_PER_YEAR_TO_KM_S = 4.7406;

const SOFTENING = 0.02;          // AU — keeps close encounters finite
const PRESET_SOFTENING = 0.0005; // periodic orbits pass within ~0.02 AU, so barely soften
const ETA = 0.004;               // adaptive step accuracy factor

// Move to the centre-of-mass frame: zero total momentum, COM at origin.
function toComFrame(list) {
  const M = list.reduce((s, b) => s + b.mass, 0);
  let cx = 0, cy = 0, cvx = 0, cvy = 0;
  for (const b of list) {
    cx += b.mass * b.x; cy += b.mass * b.y;
    cvx += b.mass * b.vx; cvy += b.mass * b.vy;
  }
  cx /= M; cy /= M; cvx /= M; cvy /= M;
  for (const b of list) {
    b.x -= cx; b.y -= cy;
    b.vx -= cvx; b.vy -= cvy;
  }
}

// Rotate a whole configuration so presets don't always look identical.
function rotate(list, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const b of list) {
    [b.x, b.y] = [c * b.x - s * b.y, s * b.x + c * b.y];
    [b.vx, b.vy] = [c * b.vx - s * b.vy, s * b.vx + c * b.vy];
  }
}

function kineticEnergy(list) {
  return list.reduce((s, b) => s + 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy), 0);
}

function potentialEnergy(list) {
  let pe = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const r = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
      pe -= (G * list[i].mass * list[j].mass) / r;
    }
  }
  return pe;
}

// Total energy with the same softened potential the forces come from, so it
// is exactly what the integrator should conserve.
function totalEnergy(list, eps) {
  let pe = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const dx = list[i].x - list[j].x, dy = list[i].y - list[j].y;
      pe -= (G * list[i].mass * list[j].mass) / Math.sqrt(dx * dx + dy * dy + eps * eps);
    }
  }
  return kineticEnergy(list) + pe;
}

// How close star i is to escaping the other two: (v / v_escape)² − 1. The
// speed is taken relative to the pair's centre of mass, the pull from each of
// the two separately — so a star in a tight binary counts as bound to its
// partner, and far away it is the usual two-body escape condition.
// Below 0 it is bound, 0 is exactly escape speed, above 0 it can leave.
function escapeRatio(list, i, eps) {
  const s = list[i], p = list[(i + 1) % 3], q = list[(i + 2) % 3];
  const M = p.mass + q.mass;
  const dvx = s.vx - (p.vx * p.mass + q.vx * q.mass) / M;
  const dvy = s.vy - (p.vy * p.mass + q.vy * q.mass) / M;
  const eps2 = eps * eps;
  const pull = p.mass / Math.sqrt((s.x - p.x) ** 2 + (s.y - p.y) ** 2 + eps2)
    + q.mass / Math.sqrt((s.x - q.x) ** 2 + (s.y - q.y) ** 2 + eps2);
  return (0.5 * (dvx * dvx + dvy * dvy)) / (G * (1 + s.mass / M) * pull) - 1;
}

function computeAccelerations(list, eps) {
  for (const b of list) { b.ax = 0; b.ay = 0; }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const r2 = dx * dx + dy * dy + eps * eps;
      const inv = G / (r2 * Math.sqrt(r2));
      a.ax += dx * inv * b.mass; a.ay += dy * inv * b.mass;
      b.ax -= dx * inv * a.mass; b.ay -= dy * inv * a.mass;
    }
  }
}

// Step size shrinks during close encounters.
function adaptiveDt(list, eps) {
  let dt = Infinity;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const r = Math.sqrt(dx * dx + dy * dy + eps * eps);
      const v = Math.hypot(b.vx - a.vx, b.vy - a.vy) + 1e-9;
      const tDyn = Math.sqrt((r * r * r) / (G * (a.mass + b.mass)));
      dt = Math.min(dt, tDyn, r / v);
    }
  }
  return dt * ETA * 2 * Math.PI;
}

// Velocity Verlet (kick–drift–kick).
function step(list, dt, eps) {
  for (const b of list) {
    b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
    b.x += dt * b.vx; b.y += dt * b.vy;
  }
  computeAccelerations(list, eps);
  for (const b of list) {
    b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
  }
}

// A star has escaped when it is unbound from the remaining pair, moving away,
// and far from it. The system has dissolved — time for a new one.
function systemDissolved(list) {
  for (let i = 0; i < 3; i++) {
    const s = list[i];
    const p = list[(i + 1) % 3], q = list[(i + 2) % 3];
    const M = p.mass + q.mass;
    const px = (p.x * p.mass + q.x * q.mass) / M;
    const py = (p.y * p.mass + q.y * q.mass) / M;
    const pvx = (p.vx * p.mass + q.vx * q.mass) / M;
    const pvy = (p.vy * p.mass + q.vy * q.mass) / M;
    const dx = s.x - px, dy = s.y - py;
    const dvx = s.vx - pvx, dvy = s.vy - pvy;
    const r = Math.hypot(dx, dy);
    const pairSep = Math.hypot(p.x - q.x, p.y - q.y);
    const energy = 0.5 * (dvx * dvx + dvy * dvy) - (G * (M + s.mass)) / r;
    const receding = dx * dvx + dy * dvy > 0;
    if (energy > 0 && receding && r > 10 && r > 5 * pairSep) return true;
    if (r > 60) return true;
  }
  return false;
}
