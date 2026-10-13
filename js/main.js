// ---------------------------------------------------------------------------
// Main loop and start-up. An ES module, so it runs after every classic script
// has defined its functions and state; those it reaches as globals. Drawing is
// done by the WebGL renderer in js/gl/.
// ---------------------------------------------------------------------------
import { Renderer } from './gl/renderer.js';

let renderer = null;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  console.error(e);
  document.querySelector('.no-webgl').hidden = false;
}
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
  pruneBursts();
  renderer.render(frameNow, realDt);
  updateHud(realDt);
  requestAnimationFrame(frame);
}

function onResize() {
  resize();
  renderer?.resize();
}

window.addEventListener('resize', onResize);
onResize();
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
setWaves(showWaves);
setDust(showDust);
setBloom(showBloom);
setTrailColor(trailColor);
randomizeMasses();
reset();
if (renderer) requestAnimationFrame(frame);
