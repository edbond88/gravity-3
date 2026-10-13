'use strict';

// ---------------------------------------------------------------------------
// Synthesized sounds (Web Audio API) — no audio files needed.
// ---------------------------------------------------------------------------
const sound = (() => {
  let ac = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = false;

  function init() {
    ac = new AudioContext();

    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(compressor).connect(ac.destination);

    // two seconds of white noise, reused by every rumble
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function setEnabled(on) {
    if (on && !ac) init();
    enabled = on;
    if (ac) on ? ac.resume() : ac.suspend();
  }

  // Exponential attack/release envelope on an AudioParam.
  function envelope(param, t, attack, release, peak) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  // Deep, muffled thump.
  //   intensity: 0..1 — loudness
  //   pan:      -1..1 — stereo position
  //   pitch:     multiplier, < 1 is lower
  function thump(intensity, pan, pitch) {
    if (!enabled || !ac) return;
    const t = ac.currentTime + 0.01;
    const vol = 0.25 + 0.75 * intensity;

    const out = ac.createStereoPanner();
    out.pan.value = pan;
    out.connect(master);

    // sub-bass body: sine sweeping down
    const f0 = 72 * pitch, f1 = 34 * pitch;
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f0, t);
    sub.frequency.exponentialRampToValueAtTime(f1, t + 1.2);
    const subGain = ac.createGain();
    envelope(subGain.gain, t, 0.03, 1.6, vol);
    sub.connect(subGain).connect(out);

    // soft overtone so the thump is audible on small speakers
    const harm = ac.createOscillator();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(f0 * 2, t);
    harm.frequency.exponentialRampToValueAtTime(f1 * 2, t + 1);
    const harmFilter = ac.createBiquadFilter();
    harmFilter.type = 'lowpass';
    harmFilter.frequency.value = 220;
    const harmGain = ac.createGain();
    envelope(harmGain.gain, t, 0.02, 0.9, vol * 0.35);
    harm.connect(harmFilter).connect(harmGain).connect(out);

    // rumble: low-passed noise swelling in and out
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ac.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.Q.value = 0.7;
    noiseFilter.frequency.setValueAtTime(90, t);
    noiseFilter.frequency.linearRampToValueAtTime(260, t + 0.25);
    noiseFilter.frequency.exponentialRampToValueAtTime(60, t + 1.5);
    const noiseGain = ac.createGain();
    envelope(noiseGain.gain, t, 0.25, 1.4, vol * 0.5);
    noise.connect(noiseFilter).connect(noiseGain).connect(out);

    for (const src of [sub, harm, noise]) {
      src.start(t);
      src.stop(t + 2);
    }
  }

  return {
    setEnabled,
    thump,
    get enabled() { return enabled; },
  };
})();
