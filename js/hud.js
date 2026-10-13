'use strict';

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const timeEl = document.getElementById('time');
const timeUnitEl = document.getElementById('time-unit');
const energyEl = document.getElementById('energy');
let energy0 = 0;

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

// 0.0000021 → "2.1×10⁻⁶"; from 1% up it reads better as a percentage.
function formatDrift(x) {
  if (x >= 0.01) return `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;
  if (x < 1e-12) return '<10⁻¹²';
  const exp = Math.floor(Math.log10(x));
  const mant = x / 10 ** exp;
  return `${mant.toFixed(1)}×10${String(exp).replace(/./g, (c) => SUPERSCRIPT[c])}`;
}
// "1 year / 2 years", "1 рік / 2 роки / 5 років"
const yearUnit = (n) => t(`unit.year.${new Intl.PluralRules(lang).select(n)}`);
const speedEls = [0, 1, 2].map((i) => document.getElementById(`speed-${i}`));
const massEls = [0, 1, 2].map((i) => document.getElementById(`mass-${i}`));
let hudTimer = 0;

function updateHud(realDt) {
  hudTimer -= realDt;
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  const years = Math.floor(simTime);
  timeEl.textContent = years.toString();
  timeUnitEl.textContent = yearUnit(years);
  if (!drag) {
    const drift = Math.abs((totalEnergy(bodies, softening) - energy0) / (Math.abs(energy0) || 1));
    energyEl.textContent = formatDrift(drift);
    energyEl.dataset.level = drift < 1e-3 ? 'ok' : drift < 0.05 ? 'warn' : 'bad';
  }
  bodies.forEach((b, i) => {
    speedEls[i].textContent = Math.round(Math.hypot(b.vx, b.vy) * AU_PER_YEAR_TO_KM_S).toString();
    massEls[i].textContent = b.mass.toFixed(2);
  });
}
