'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

const { dust, DUST_STEP, resetDust, advanceDust, shiftDust } = load(['dust.js'],
  ['dust', 'DUST_STEP', 'resetDust', 'advanceDust', 'shiftDust']);

const star = (x, y, mass, vx = 0, vy = 0) => ({ x, y, mass, vx, vy });

test('a snapshot of the stars is queued once a step\'s worth of time has passed', () => {
  resetDust();
  const list = [star(1, 2, 1, 0.5, -0.5), star(-1, 0, 2), star(0, 3, 0.5)];
  advanceDust(list, DUST_STEP * 0.6);
  assert.equal(dust.queue.length, 0);
  advanceDust(list, DUST_STEP * 0.6);
  assert.equal(dust.queue.length, 1);
  const job = dust.queue[0];
  assert.ok(Math.abs(job.dt - DUST_STEP * 1.2) < 1e-12, 'the whole elapsed time, none lost');
  assert.deepEqual(Array.from(job.bodies[0]), [1, 2, 1, 0.5, -0.5]);
});

test('longer steps mean fewer snapshots', () => {
  resetDust();
  const list = [star(0, 0, 1), star(1, 0, 1), star(2, 0, 1)];
  // binary fractions, so the sums are exact: 8 small steps make one long one
  for (let i = 0; i < 100; i++) advanceDust(list, 1 / 1024, 1 / 128);
  assert.equal(dust.queue.length, 12);  // the 13th still building up
});

test('recentring is queued in order with the steps', () => {
  resetDust();
  const list = [star(0, 0, 1), star(1, 0, 1), star(2, 0, 1)];
  advanceDust(list, DUST_STEP);
  shiftDust(0.5, -0.5, 1, 2);
  advanceDust(list, DUST_STEP);
  assert.deepEqual(Array.from(dust.queue, (j) => (j.shift ? 'shift' : 'step')), ['step', 'shift', 'step']);
  assert.deepEqual(Array.from(dust.queue[1].shift), [0.5, -0.5, 1, 2]);
});

test('a reset asks for a fresh cloud and forgets what was queued', () => {
  dust.reseed = false;
  dust.queue.push({ shift: [0, 0, 0, 0] });
  resetDust();
  assert.equal(dust.reseed, true);
  assert.equal(dust.queue.length, 0);
});
