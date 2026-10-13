'use strict';

// ---------------------------------------------------------------------------
// Main loop and start-up. Loaded last, once every other script has defined
// its functions and state.
// ---------------------------------------------------------------------------
let lastFrame = performance.now();

function frame(now) {
  const realDt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  frameNow = now / 1000;

  if (!paused) {
    advance(realDt * rate);
    if (!restarting && !drag && systemDissolved(bodies)) restart();
  }
  updateCamera(realDt);
  drawBackground(frameNow);
  render();
  updateHud(realDt);
  requestAnimationFrame(frame);
}

canvas.style.transition = 'opacity 0.9s ease';
window.addEventListener('resize', resize);
resize();
window.addEventListener('langchange', () => {
  pauseBtn.textContent = t(paused ? 'play' : 'pause');
  uiBtn.title = t(uiHidden ? 'ui.show' : 'ui.hide');
  hudTimer = 0; // re-render the year unit in the new language
  soundBtn.textContent = t(sound.enabled ? 'sound.on' : 'sound.off');
  presetNote.textContent = t(presetSelect.selectedOptions[0].dataset.note);
});
applyLang();
setSpeed(0);
setField(fieldMode);
setTrails(showTrails);
setBursts(showBursts);
setTrailColor(trailColor);
randomizeMasses();
reset();
requestAnimationFrame(frame);
