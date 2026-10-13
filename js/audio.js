'use strict';

// ---------------------------------------------------------------------------
// Synthesized sounds (Web Audio API) — no audio files needed.
// ---------------------------------------------------------------------------
const sound = (() => {
  let ac = null;
  let master = null;
  let reverb = null;
  let noiseBuffer = null;
  let enabled = false;
  let voices = 0;

  const MAX_VOICES = 6;      // at high time speeds encounters come in bursts
  const REVERB_SECONDS = 3.2;

  // Notes an encounter can ring at: A minor pentatonic, A2…A4. Any of them
  // sound fine together, so overlapping encounters make chords, not clashes.
  const SCALE = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440];

  function init() {
    ac = new AudioContext();

    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.3;
    // a fast, hard limiter last, so bursts of encounters never clip
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.2;
    master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(compressor).connect(limiter).connect(ac.destination);

    reverb = ac.createConvolver();
    reverb.buffer = impulseResponse();
    const wet = ac.createGain();
    wet.gain.value = 0.5;
    reverb.connect(wet).connect(master);

    // a short burst of white noise for the attack of each thump
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // A large, dark space: stereo noise that decays exponentially, smoothed more
  // and more over time so the tail loses its highs the way real rooms do.
  function impulseResponse() {
    const rate = ac.sampleRate;
    const n = Math.floor(rate * REVERB_SECONDS);
    const buf = ac.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const k = 0.5 - 0.47 * t; // one-pole low-pass, closing over time
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * (1 - t) ** 3 * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
      }
    }
    return buf;
  }

  function setEnabled(on) {
    if (on && !ac) init();
    enabled = on;
    if (ac) on ? ac.resume() : ac.suspend();
  }

  // Linear fade-in (no click), then an exponential decay.
  function envelope(param, t, attack, decay, peak) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(0, t + attack, decay / 4);
  }

  function nearestNote(freq) {
    return SCALE.reduce((best, f) => (Math.abs(Math.log(f / freq)) < Math.abs(Math.log(best / freq)) ? f : best));
  }

  // A soft, deep impact with a ringing tone in a large space.
  //   intensity: 0..1 — loudness
  //   pan:      -1..1 — stereo position
  //   pitch:     multiplier, < 1 is lower (heavier pair)
  function thump(intensity, pan, pitch) {
    if (!enabled || !ac || voices >= MAX_VOICES) return;
    const t = ac.currentTime + 0.01;
    // quieter when others are still ringing, so overlaps don't pile up
    const vol = (0.3 + 0.7 * intensity) / (1 + 0.6 * voices);
    const end = t + 3;
    voices++;

    const out = ac.createStereoPanner();
    out.pan.value = pan;
    out.connect(master);
    const send = ac.createGain(); // to the reverb
    send.gain.value = 0.6;
    out.connect(send).connect(reverb);

    const sources = [];

    // body: a sine that drops quickly in pitch, like a soft kick drum
    const f0 = 46 * pitch;
    const body = ac.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(f0 * 2.6, t);
    body.frequency.exponentialRampToValueAtTime(f0, t + 0.09);
    const bodyGain = ac.createGain();
    envelope(bodyGain.gain, t, 0.006, 0.7 + 0.5 * intensity, vol * 0.9);
    body.connect(bodyGain).connect(out);
    sources.push(body);

    // attack: a brief, dark puff of noise so the impact has some texture
    const puff = ac.createBufferSource();
    puff.buffer = noiseBuffer;
    const puffFilter = ac.createBiquadFilter();
    puffFilter.type = 'lowpass';
    puffFilter.frequency.setValueAtTime(900, t);
    puffFilter.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    const puffGain = ac.createGain();
    envelope(puffGain.gain, t, 0.004, 0.12, vol * 0.25);
    puff.connect(puffFilter).connect(puffGain).connect(out);
    sources.push(puff);

    // tone: a quiet bell-like note — a fundamental and an inharmonic partial
    const note = nearestNote(165 * pitch);
    for (const [ratio, level, decay] of [[1, 0.13, 2.4], [2.76, 0.035, 0.9], [5.4, 0.012, 0.4]]) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = note * ratio;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t); // silent until its envelope starts
      envelope(g.gain, t + 0.015, 0.01, decay, vol * level);
      osc.connect(g).connect(out);
      sources.push(osc);
    }

    for (const src of sources) {
      src.start(t);
      src.stop(end);
    }
    body.onended = () => { voices--; };
  }

  return {
    setEnabled,
    thump,
    get enabled() { return enabled; },
  };
})();
