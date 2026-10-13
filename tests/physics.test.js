'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

const {
  G, SOFTENING, toComFrame, rotate, kineticEnergy, potentialEnergy, totalEnergy,
  escapeRatio, computeAccelerations, adaptiveDt, step, systemDissolved,
} = load(['physics.js'], [
  'G', 'SOFTENING', 'toComFrame', 'rotate', 'kineticEnergy', 'potentialEnergy', 'totalEnergy',
  'escapeRatio', 'computeAccelerations', 'adaptiveDt', 'step', 'systemDissolved',
]);

const body = (mass, x, y, vx = 0, vy = 0) => ({ mass, x, y, vx, vy, ax: 0, ay: 0 });

// Same loop as the app's advance(), without trails and encounters.
function integrate(list, years, eps) {
  computeAccelerations(list, eps);
  let t = 0;
  while (t < years) {
    const dt = Math.min(adaptiveDt(list, eps), years - t);
    step(list, dt, eps);
    t += dt;
  }
}

const momentum = (list) => [
  list.reduce((s, b) => s + b.mass * b.vx, 0),
  list.reduce((s, b) => s + b.mass * b.vy, 0),
];
const angularMomentum = (list) => list.reduce((s, b) => s + b.mass * (b.x * b.vy - b.y * b.vx), 0);

// A bound, unequal-mass system with no symmetry to hide mistakes behind.
function scalene() {
  const list = [body(1.3, 2.1, 0.4, 0.3, 1.9), body(0.7, -1.5, 1.8, -2.2, -0.6), body(1.9, 0.2, -2.6, 1.1, -0.4)];
  toComFrame(list);
  return list;
}

test('G is 4π² in AU, years and solar masses', () => {
  assert.ok(Math.abs(G - 39.4784176) < 1e-6);
});

test('toComFrame puts the centre of mass at rest at the origin', () => {
  const list = [body(1, 3, 4, 1, 2), body(2, -1, 0, 0, -3), body(0.5, 7, 7, 5, 5)];
  toComFrame(list);
  const M = 3.5;
  assert.ok(Math.abs(list.reduce((s, b) => s + b.mass * b.x, 0) / M) < 1e-12);
  assert.ok(Math.abs(list.reduce((s, b) => s + b.mass * b.y, 0) / M) < 1e-12);
  for (const p of momentum(list)) assert.ok(Math.abs(p) < 1e-12);
});

test('rotate keeps distances and energy', () => {
  const list = scalene();
  const e0 = totalEnergy(list, SOFTENING);
  const d0 = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  rotate(list, 1.234);
  assert.ok(Math.abs(totalEnergy(list, SOFTENING) - e0) < 1e-12);
  assert.ok(Math.abs(Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) - d0) < 1e-12);
});

test('energies of a simple pair', () => {
  const list = [body(1, 0, 0, 0, 1), body(2, 2, 0, 0, -0.5)];
  assert.equal(kineticEnergy(list), 0.5 * 1 * 1 + 0.5 * 2 * 0.25);
  assert.ok(Math.abs(potentialEnergy(list) - -G) < 1e-12);           // −G·1·2 / 2
  assert.ok(totalEnergy(list, 0.1) > totalEnergy(list, 0));         // softening makes the well shallower
  assert.equal(totalEnergy(list, 0), kineticEnergy(list) + potentialEnergy(list));
});

test('accelerations follow the inverse-square law and Newton\'s third law', () => {
  const list = [body(1, 0, 0), body(3, 2, 0)];
  computeAccelerations(list, 0);
  assert.ok(Math.abs(list[0].ax - (G * 3) / 4) < 1e-12);
  assert.ok(Math.abs(list[1].ax - (-G * 1) / 4) < 1e-12);
  assert.equal(list[0].ay, 0);

  const three = scalene();
  computeAccelerations(three, SOFTENING);
  const fx = three.reduce((s, b) => s + b.mass * b.ax, 0);
  const fy = three.reduce((s, b) => s + b.mass * b.ay, 0);
  assert.ok(Math.abs(fx) < 1e-12 && Math.abs(fy) < 1e-12);
});

test('softening keeps the force finite when two stars coincide', () => {
  const list = [body(1, 0, 0), body(1, 0, 0)];
  computeAccelerations(list, SOFTENING);
  assert.ok(Number.isFinite(list[0].ax) && Number.isFinite(adaptiveDt(list, SOFTENING)));
});

test('an Earth-like orbit takes one year', () => {
  // The Sun's mass dominates, so a 1 AU circular orbit has v = 2π AU/yr, T = 1 yr.
  const list = [body(1, 0, 0), body(1e-6, 1, 0, 0, 2 * Math.PI)];
  toComFrame(list);
  const start = { x: list[1].x, y: list[1].y };
  // ETA gives ~250 steps per orbit, which lags the phase by about 10⁻³.
  integrate(list, 1, 0);
  assert.ok(Math.hypot(list[1].x - start.x, list[1].y - start.y) < 5e-3);
  integrate(list, 0.5, 0);
  assert.ok(Math.abs(list[1].x - list[0].x + 1) < 5e-3);          // half a year later: the far side
});

test('the step shrinks as stars get closer', () => {
  const far = [body(1, 0, 0), body(1, 4, 0)];
  const near = [body(1, 0, 0), body(1, 0.4, 0)];
  assert.ok(adaptiveDt(near, SOFTENING) < adaptiveDt(far, SOFTENING) / 10);
});

test('integration conserves energy, momentum and angular momentum', () => {
  const list = scalene();
  const e0 = totalEnergy(list, SOFTENING);
  const l0 = angularMomentum(list);
  integrate(list, 10, SOFTENING);
  // A few close passes in 10 years; the HUD calls anything under 5% acceptable.
  assert.ok(Math.abs((totalEnergy(list, SOFTENING) - e0) / e0) < 1e-2);
  assert.ok(Math.abs((angularMomentum(list) - l0) / l0) < 1e-9);
  for (const p of momentum(list)) assert.ok(Math.abs(p) < 1e-9);
});

test('velocity Verlet is time-reversible', () => {
  const list = scalene();
  const start = list.map((b) => ({ ...b }));
  const dt = 1e-3, n = 2000;
  computeAccelerations(list, SOFTENING);
  for (let i = 0; i < n; i++) step(list, dt, SOFTENING);
  for (const b of list) { b.vx = -b.vx; b.vy = -b.vy; }
  for (let i = 0; i < n; i++) step(list, dt, SOFTENING);
  list.forEach((b, i) => {
    assert.ok(Math.hypot(b.x - start[i].x, b.y - start[i].y) < 1e-8);
  });
});

test('escapeRatio is −½ on a circular orbit and 0 at escape speed', () => {
  // Star 0 far from a tight pair: effectively the two-body problem.
  const r = 100, M = 2, m = 0.5;
  const vCirc = Math.sqrt((G * (M + m)) / r);
  const at = (v) => [body(m, r, 0, 0, v), body(1, -0.01, 0), body(1, 0.01, 0)];
  assert.ok(Math.abs(escapeRatio(at(vCirc), 0, 0) + 0.5) < 1e-3);
  assert.ok(Math.abs(escapeRatio(at(vCirc * Math.SQRT2), 0, 0)) < 1e-3);
  assert.ok(escapeRatio(at(vCirc * 2), 0, 0) > 0);
});

test('systemDissolved spots an escaping star but not a bound system', () => {
  assert.equal(systemDissolved(scalene()), false);

  const fleeing = [body(1, -0.5, 0, 0, 3), body(1, 0.5, 0, 0, -3), body(1, 20, 0, 10, 0)];
  assert.equal(systemDissolved(fleeing), true);

  const returning = [body(1, -0.5, 0, 0, 3), body(1, 0.5, 0, 0, -3), body(1, 20, 0, -10, 0)];
  assert.equal(systemDissolved(returning), false);                // falling back in

  const lost = [body(1, -0.5, 0), body(1, 0.5, 0), body(1, 61, 0)];
  assert.equal(systemDissolved(lost), true);                      // too far to bother
});
