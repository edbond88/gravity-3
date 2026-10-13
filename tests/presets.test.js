'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load');

const {
  SOFTENING, PRESET_SOFTENING, PRESETS, kineticEnergy, potentialEnergy, totalEnergy,
  computeAccelerations, adaptiveDt, step,
} = load(['physics.js', 'presets.js'], [
  'SOFTENING', 'PRESET_SOFTENING', 'PRESETS', 'kineticEnergy', 'potentialEnergy', 'totalEnergy',
  'computeAccelerations', 'adaptiveDt', 'step',
]);

const EQUAL = [1, 1, 1];
const UNEQUAL = [1.5, 0.8, 1.2];
const massSets = (p) => (p.equal ? [EQUAL] : [EQUAL, UNEQUAL, [0.2, 5, 0.2]]);
const eps = (name) => (name === 'chaos' ? SOFTENING : PRESET_SOFTENING);

// Same loop as the app's advance(); `each` runs after every step.
function integrate(list, years, softening, each = () => {}) {
  computeAccelerations(list, softening);
  let t = 0;
  while (t < years) {
    const dt = Math.min(adaptiveDt(list, softening), years - t);
    step(list, dt, softening);
    t += dt;
    each(list, t);
  }
}

test('presets match the <select> in index.html, in order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const select = html.match(/<select id="preset"[\s\S]*?<\/select>/)[0];
  const options = [...select.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(options, Object.keys(PRESETS));
});

for (const [name, preset] of Object.entries(PRESETS)) {
  test(`${name}: starts in the centre-of-mass frame with the requested masses`, () => {
    for (const masses of massSets(preset)) {
      const list = preset.create(masses);
      assert.equal(list.length, 3);
      assert.deepEqual(Array.from(list, (b) => b.mass), masses);
      const M = masses.reduce((a, b) => a + b, 0);
      for (const k of ['x', 'y', 'vx', 'vy']) {
        assert.ok(Math.abs(list.reduce((s, b) => s + b.mass * b[k], 0) / M) < 1e-12, k);
      }
      assert.ok(totalEnergy(list, eps(name)) < 0, 'bound');
      if (name !== 'chaos') assert.ok(list.period > 0, 'has a period');
    }
  });
}

test('chaos: stars start apart and the system is bound by KE ≈ 0.25…0.45 |PE|', () => {
  for (let n = 0; n < 200; n++) {
    const list = PRESETS.chaos.create(UNEQUAL);
    const q = kineticEnergy(list) / -potentialEnergy(list);
    assert.ok(q >= 0.25 - 1e-9 && q <= 0.45 + 1e-9, `q = ${q}`);
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
      assert.ok(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) >= 2);
    }
  }
});

// In the Lagrange and Euler solutions the whole figure turns rigidly, so every
// star's acceleration must point at the centre with a = ω²·r.
for (const name of ['lagrange', 'euler']) {
  test(`${name}: each star is accelerated exactly as rigid rotation needs`, () => {
    for (const masses of massSets(PRESETS[name])) {
      const list = PRESETS[name].create(masses);
      const w2 = ((2 * Math.PI) / list.period) ** 2;
      computeAccelerations(list, 0);
      for (const b of list) {
        assert.ok(Math.hypot(b.ax + w2 * b.x, b.ay + w2 * b.y) < 1e-9 * Math.max(1, Math.hypot(b.ax, b.ay)));
      }
    }
  });
}

test('euler: the stars stay in a line over one turn', () => {
  for (const masses of massSets(PRESETS.euler)) {
    const list = PRESETS.euler.create(masses);
    let worst = 0;
    integrate(list, list.period, PRESET_SOFTENING, ([a, b, c]) => {
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      worst = Math.max(worst, Math.abs(cross) / Math.hypot(c.x - a.x, c.y - a.y));
    });
    assert.ok(worst < 0.01, `middle star ${worst} AU off the line`);
  }
});

// Periodic orbits come back to where they started after one period, with the
// same velocities. Distance is measured in phase space — position plus
// velocity × T/2π, both in AU — since some orbits pass close to their starting
// positions mid-period, but moving differently. The figure-eight's initial
// conditions have eight digits; the Šuvakov orbits only five, and they are
// unstable, so they come back less precisely. Mid-period every orbit is > 0.9 away.
const RETURN = {
  lagrange: 0.02, euler: 0.02, figure8: 2e-3,
  butterfly: 0.1, moth: 0.05, goggles: 0.3, dragonfly: 1, yinyang: 0.5,
};

const phaseDistance = (list, from, period) => {
  const c = period / (2 * Math.PI);
  return Math.max(...list.map((b, i) =>
    Math.hypot(b.x - from[i].x, b.y - from[i].y) + c * Math.hypot(b.vx - from[i].vx, b.vy - from[i].vy)));
};

for (const [name, tolerance] of Object.entries(RETURN)) {
  test(`${name}: returns to its starting state after one period, and not before`, () => {
    for (const masses of massSets(PRESETS[name])) {
      const list = PRESETS[name].create(masses);
      const T = list.period;
      const start = list.map((b) => ({ ...b }));
      const e0 = totalEnergy(list, PRESET_SOFTENING);
      let closestMid = Infinity;
      integrate(list, T, PRESET_SOFTENING, (_, t) => {
        if (t > 0.1 * T && t < 0.9 * T) closestMid = Math.min(closestMid, phaseDistance(list, start, T));
      });
      const end = phaseDistance(list, start, T);
      assert.ok(end < tolerance, `off by ${end}`);
      assert.ok(closestMid > 0.9, `already back mid-period: ${closestMid}`);
      assert.ok(Math.abs((totalEnergy(list, PRESET_SOFTENING) - e0) / e0) < 5e-3, 'energy drift');
    }
  });
}

test('hierarchical: the binary stays tight while the outer star goes round once', () => {
  for (const masses of massSets(PRESETS.hierarchical)) {
    const list = PRESETS.hierarchical.create(masses);
    const outer = { x: list[2].x, y: list[2].y };
    let minSep = Infinity, maxSep = 0;
    integrate(list, list.period, PRESET_SOFTENING, ([a, b]) => {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      minSep = Math.min(minSep, d);
      maxSep = Math.max(maxSep, d);
    });
    assert.ok(minSep > 0.65 && maxSep < 0.75, `binary separation ${minSep}…${maxSep}`);
    assert.ok(Math.hypot(list[2].x - outer.x, list[2].y - outer.y) < 0.3);
  }
});
