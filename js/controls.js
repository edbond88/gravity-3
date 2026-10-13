'use strict';

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const pauseBtn = document.getElementById('btn-pause');
const restartBtn = document.getElementById('btn-restart');
const speedRange = document.getElementById('speed-range');
const speedLabel = document.getElementById('speed-label');

function setPaused(p) {
  paused = p;
  pauseBtn.textContent = t(paused ? 'play' : 'pause');
  document.body.classList.toggle('paused', paused);
}

function setSpeed(exp) {
  exp = Math.max(-2, Math.min(2, exp));
  speedRange.value = exp;
  rate = BASE_RATE * 2 ** exp;
  const m = 2 ** exp;
  speedLabel.textContent = (m < 1 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(m % 1 ? 1 : 0)) + '×';
}

const massRanges = [0, 1, 2].map((i) => document.getElementById(`mass-range-${i}`));
const massLabels = [0, 1, 2].map((i) => document.getElementById(`mass-label-${i}`));

function setMass(i, m) {
  masses[i] = m;
  massRanges[i].value = m;
  massLabels[i].textContent = m.toFixed(2);
}

function randomizeMasses() {
  for (let i = 0; i < 3; i++) setMass(i, Math.round(rand(0.8, 2.0) * 20) / 20);
}

const presetSelect = document.getElementById('preset');
const presetNote = document.getElementById('preset-note');

function setPreset(p) {
  preset = p;
  presetSelect.value = p;
  presetNote.textContent = t(presetSelect.selectedOptions[0].dataset.note);
  if (PRESETS[p].equal) for (let i = 0; i < 3; i++) setMass(i, 1);
  restart();
}


const soundBtn = document.getElementById('btn-sound');

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  soundBtn.textContent = t(sound.enabled ? 'sound.on' : 'sound.off');
}

pauseBtn.addEventListener('click', () => setPaused(!paused));
restartBtn.addEventListener('click', restart);
soundBtn.addEventListener('click', toggleSound);
speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));
massRanges.forEach((el, i) => {
  // Label follows the thumb; the simulation restarts once the drag ends.
  el.addEventListener('input', () => setMass(i, parseFloat(el.value)));
  // Equal-mass orbits don't exist for other masses, so fall back to chaos.
  el.addEventListener('change', () => (PRESETS[preset].equal ? setPreset('chaos') : restart()));
});
document.getElementById('btn-random-masses').addEventListener('click', shuffleMasses);
const trailsCheckbox = document.getElementById('trails');
let showTrails = localStorage.getItem('trails') !== 'off';

function setTrails(on) {
  showTrails = on;
  trailsCheckbox.checked = on;
  localStorage.setItem('trails', on ? 'on' : 'off');
}

trailsCheckbox.addEventListener('change', () => {
  setTrails(trailsCheckbox.checked);
  trailsCheckbox.blur(); // keep keyboard shortcuts working
});

const trailColorSelect = document.getElementById('trail-color');
const trailColorNote = document.getElementById('trail-color-note');
const TRAIL_COLORS = ['speed', 'energy'];
let trailColor = TRAIL_COLORS.includes(localStorage.getItem('trailColor')) ? localStorage.getItem('trailColor') : 'speed';

function setTrailColor(mode) {
  trailColor = mode;
  trailColorSelect.value = mode;
  trailColorNote.hidden = mode !== 'energy';
  localStorage.setItem('trailColor', mode);
}

trailColorSelect.addEventListener('change', () => {
  setTrailColor(trailColorSelect.value);
  trailColorSelect.blur(); // keep keyboard shortcuts working
});

const burstsCheckbox = document.getElementById('bursts');
let showBursts = localStorage.getItem('bursts') !== 'off';

function setBursts(on) {
  showBursts = on;
  burstsCheckbox.checked = on;
  if (!on) bursts = [];
  localStorage.setItem('bursts', on ? 'on' : 'off');
}

burstsCheckbox.addEventListener('change', () => {
  setBursts(burstsCheckbox.checked);
  burstsCheckbox.blur(); // keep keyboard shortcuts working
});

const fieldSelect = document.getElementById('field');

function setField(mode) {
  fieldMode = mode;
  fieldSelect.value = mode;
  localStorage.setItem('field', mode);
}

fieldSelect.addEventListener('change', () => {
  setField(fieldSelect.value);
  fieldSelect.blur(); // keep keyboard shortcuts working
});

presetSelect.addEventListener('change', () => {
  setPreset(presetSelect.value);
  presetSelect.blur(); // keep keyboard shortcuts working
});

function shuffleMasses() {
  randomizeMasses();
  if (PRESETS[preset].equal) setPreset('chaos');
  else restart();
}

// On phones the start/masses panel is a sheet toggled from the controls bar;
// it sits right above the bar, whose height changes as it wraps.
function setSettings(open) {
  document.body.classList.toggle('settings-open', open);
}

document.getElementById('btn-settings').addEventListener('click', () => {
  setSettings(!document.body.classList.contains('settings-open'));
});
canvas.addEventListener('pointerdown', () => setSettings(false));
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--controls-h', `${controlsEl.offsetHeight}px`);
}).observe(controlsEl);

const uiBtn = document.getElementById('btn-ui');
let uiHidden = false; // the camera keeps its framing, so the view doesn't jump

function setUiHidden(hidden) {
  uiHidden = hidden;
  if (hidden) setSettings(false);
  document.body.classList.toggle('ui-hidden', hidden);
  uiBtn.setAttribute('aria-pressed', String(hidden));
  uiBtn.title = t(hidden ? 'ui.show' : 'ui.hide');
}

uiBtn.addEventListener('click', () => {
  setUiHidden(!uiHidden);
  uiBtn.blur(); // keep Space for pause, not for pressing this button again
});

const helpEl = document.getElementById('help');

function setHelp(open) {
  helpEl.hidden = !open;
}

document.getElementById('btn-help').addEventListener('click', () => setHelp(true));
document.getElementById('help-close').addEventListener('click', () => setHelp(false));
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) setHelp(false); });

window.addEventListener('keydown', (e) => {
  if (e.key === '?' || e.code === 'KeyH') { setHelp(helpEl.hidden); return; }
  if (!helpEl.hidden) {
    if (e.code === 'Escape') setHelp(false);
    return; // other shortcuts are off while help is open
  }
  if (e.code === 'Escape') { setSettings(false); return; }
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyN') shuffleMasses();
  else if (e.code === 'KeyU') setUiHidden(!uiHidden);
  else if (e.code === 'KeyT') setTrails(!showTrails);
  else if (e.code === 'KeyF') setBursts(!showBursts);
  else if (e.code === 'KeyE') setTrailColor(trailColor === 'energy' ? 'speed' : 'energy');
  else if (e.code === 'KeyG') setField(FIELD_MODES[(FIELD_MODES.indexOf(fieldMode) + 1) % FIELD_MODES.length]);
  else if (/^Digit\d$/.test(e.code)) {
    // 1…9, then 0 for the tenth preset
    const n = (parseInt(e.code.slice(5), 10) + 9) % 10;
    const keys = Object.keys(PRESETS);
    if (n < keys.length) setPreset(keys[n]);
  }
  else if (e.key === '+' || e.key === '=') setSpeed(parseFloat(speedRange.value) + 0.25);
  else if (e.key === '-' || e.key === '_') setSpeed(parseFloat(speedRange.value) - 0.25);
});

// ---------------------------------------------------------------------------
// Dragging stars. Paused, a star is simply moved to a new place. Running, it
// is held under the pointer while the others keep moving around it, and when
// let go it flies off at the speed it was thrown with.
// ---------------------------------------------------------------------------
const DRAG_RADIUS = 24; // px around a star that still grabs it
const MAX_THROW = 30;   // AU/yr (~140 km/s) — a flick of the mouse can't fling a star to infinity
// { body, dx, dy, x, y, vx, vy }: grab offset and where the pointer wants the
// star, in world units; the smoothed speed it is being moved at, in AU/yr.
let drag = null;

function starAt(sx, sy) {
  let best = null, bestD = DRAG_RADIUS;
  for (const b of bodies) {
    const d = Math.hypot(toScreenX(b.x) - sx, toScreenY(b.y) - sy);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// Moving a star shifts the COM, and holding or throwing one gives the system
// momentum. Shift everything back so the COM is at rest at the origin, and let
// the camera catch up. Relative motion — all that matters — is unchanged.
function dropStar() {
  const { body } = drag;
  if (!paused) {
    const k = Math.min(1, MAX_THROW / (Math.hypot(drag.vx, drag.vy) || 1));
    body.vx = drag.vx * k;
    body.vy = drag.vy * k;
  }
  drag = null;
  const M = bodies.reduce((s, b) => s + b.mass, 0);
  const com = (key) => bodies.reduce((s, b) => s + b.mass * b[key], 0) / M;
  const cx = com('x'), cy = com('y'), cvx = com('vx'), cvy = com('vy');
  for (const b of bodies) {
    b.x -= cx; b.y -= cy;
    b.vx -= cvx; b.vy -= cvy;
    for (const p of b.trail) { p.x -= cx; p.y -= cy; }
  }
  camera.ox += cx;
  camera.oy += cy;
  computeAccelerations(bodies, softening);
  energy0 = totalEnergy(bodies, softening); // moving a star changed the energy on purpose
  resetEncounters();
}

canvas.addEventListener('pointerdown', (e) => {
  if (restarting) return;
  const b = starAt(e.clientX, e.clientY);
  if (!b) return;
  drag = { body: b, dx: b.x - toWorldX(e.clientX), dy: b.y - toWorldY(e.clientY), x: b.x, y: b.y, vx: 0, vy: 0 };
  if (paused) b.trail = []; // its history no longer leads to where it is
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    drag.x = toWorldX(e.clientX) + drag.dx;
    drag.y = toWorldY(e.clientY) + drag.dy;
    if (paused) { drag.body.x = drag.x; drag.body.y = drag.y; }
  } else {
    canvas.style.cursor = starAt(e.clientX, e.clientY) ? 'grab' : '';
  }
});

function endDrag() {
  if (!drag) return;
  dropStar();
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
