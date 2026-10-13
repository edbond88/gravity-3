'use strict';

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const bgCanvas = document.getElementById('bg');
const bg = bgCanvas.getContext('2d');
const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const statsEl = document.querySelector('.stats');

let width = 0, height = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  for (const c of [bgCanvas, canvas]) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
  }
  generateBackground();
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MOBILE_WIDTH = 760;        // px — matches the media query in style.css

// ---------------------------------------------------------------------------
// Camera: centred on the COM (the origin), zooms to keep all stars in view.
// ---------------------------------------------------------------------------
// (ox, oy) is a world-space offset that eases back to zero, so recentring the
// COM after a star is dragged doesn't make the picture jump.
const camera = { scale: 0, cx: 0, cy: 0, ox: 0, oy: 0 };

const controlsEl = document.querySelector('.controls');

function viewport() {
  const top = statsEl.getBoundingClientRect().bottom + 30;
  // On phones the controls span the full width, so keep the stars above them.
  const bottom = width <= MOBILE_WIDTH
    ? controlsEl.getBoundingClientRect().top - 20
    : height - 50;
  return {
    cx: width / 2,
    cy: (top + bottom) / 2,
    halfW: width / 2 - 60,
    halfH: Math.max(80, (bottom - top) / 2),
  };
}

const MIN_EXTENT = 2.5;   // AU — never zoom in further than this
const VIEW_MARGIN = 1.15;

// The scale of the closest view the camera allows.
const closestScale = () => viewport().halfH / (MIN_EXTENT * VIEW_MARGIN);

function updateCamera(realDt) {
  const vp = viewport();
  camera.cx = vp.cx;
  camera.cy = vp.cy;
  if (drag) return; // hold the view still while a star is being placed
  const settle = Math.exp(-realDt * 2.5);
  camera.ox *= settle;
  camera.oy *= settle;
  let extent = MIN_EXTENT;
  for (const b of bodies) {
    extent = Math.max(extent, Math.abs(b.x + camera.ox) * vp.halfH / vp.halfW, Math.abs(b.y + camera.oy));
  }
  const target = vp.halfH / (extent * VIEW_MARGIN);
  if (!camera.scale) { camera.scale = target; return; }
  const speed = target < camera.scale ? 3 : 0.6; // zoom out quickly, in gently
  camera.scale += (target - camera.scale) * (1 - Math.exp(-realDt * speed));
}

const toScreenX = (x) => camera.cx + (x + camera.ox) * camera.scale;
const toScreenY = (y) => camera.cy + (y + camera.oy) * camera.scale;
const toWorldX = (sx) => (sx - camera.cx) / camera.scale - camera.ox;
const toWorldY = (sy) => (sy - camera.cy) / camera.scale - camera.oy;
