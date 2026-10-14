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
  let voices = []; // encounter sounds still ringing: { start, fader, sources }
  let hums = [];

  const MAX_VOICES = 8;      // at high time speeds encounters come in bursts
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

    // white noise: looped, the encounters' whoosh and the drones' air —
    // long enough that the loop can't be heard
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 6, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    hums = [0, 1, 2].map((i) => createHum(i));
  }

  // One star's voice: a deep drone. Two sines a hair apart beat slowly against
  // each other, with a sine an octave below and quiet upper partials, all
  // through a low-pass that a very slow LFO keeps breathing. On top, a band of
  // filtered noise — the "air" — that rises as the star speeds up. Silent until
  // hum() turns it up.
  function createHum(i) {
    const out = ac.createStereoPanner();
    out.connect(master);
    const send = ac.createGain();
    send.gain.value = 1.2;
    out.connect(send).connect(reverb);
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(out);

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 0.5;
    filter.connect(gain);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.05 + 0.03 * i; // each voice breathes at its own pace
    const depth = ac.createGain();
    depth.gain.value = 70;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();

    const PARTIALS = [[1, 0.5], [1.0035, 0.4], [0.5, 0.35], [2, 0.12], [3, 0.05]];
    const oscs = PARTIALS.map(([ratio, level]) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      const g = ac.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start();
      return { osc, ratio };
    });

    const air = ac.createBufferSource();
    air.buffer = noiseBuffer;
    air.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 6;
    const airGain = ac.createGain();
    airGain.gain.value = 0;
    air.connect(band).connect(airGain).connect(gain);
    air.start();

    return { out, gain, filter, oscs, band, airGain };
  }

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

  // A close pass, in the drones' key: a whoosh of air that sweeps down and
  // across, like something flying by; a soft, deep swell under it; and a
  // singing-bowl tone that beats slowly and melts into the reverb.
  //   intensity: 0..1 — loudness
  //   pan:      -1..1 — stereo position
  //   pitch:     multiplier, < 1 is lower (heavier pair)
  function flyby(intensity, pan, pitch) {
    if (!enabled || !ac) return;
    const t = ac.currentTime + 0.01;
    // every encounter is heard: when too many are ringing, the oldest — by
    // now mostly its fading tail — makes room
    if (voices.length >= MAX_VOICES) release(voices.shift(), t);
    // quieter when others have just started, so bursts don't pile up
    const recent = voices.filter((v) => t - v.start < 1.5).length;
    const vol = (0.3 + 0.7 * intensity) / (1 + 0.6 * recent);
    const end = t + 7;

    const fader = ac.createGain(); // lets the whole voice be faded out early
    fader.connect(master);
    const send = ac.createGain(); // to the reverb
    send.gain.value = 1;
    fader.connect(send).connect(reverb);
    const out = ac.createStereoPanner();
    out.pan.value = pan;
    out.connect(fader);

    const sources = [];

    // whoosh: noise through a resonant band that falls, Doppler-like, while
    // it passes from one side to the other
    const whoosh = ac.createBufferSource();
    whoosh.buffer = noiseBuffer;
    whoosh.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    const sweep = 0.9 + 0.6 * intensity; // s — closer passes sweep longer
    band.frequency.setValueAtTime(1800 * pitch, t);
    band.frequency.exponentialRampToValueAtTime(140 * pitch, t + sweep);
    const across = ac.createStereoPanner();
    across.pan.setValueAtTime(Math.max(-1, pan - 0.5), t);
    across.pan.linearRampToValueAtTime(Math.min(1, pan + 0.5), t + sweep);
    const whooshGain = ac.createGain();
    whooshGain.gain.setValueAtTime(0, t);
    whooshGain.gain.linearRampToValueAtTime(vol * 0.35, t + 0.12);
    whooshGain.gain.setTargetAtTime(0, t + 0.12, sweep / 3);
    whoosh.connect(band).connect(whooshGain).connect(across).connect(fader);
    sources.push(whoosh);

    // swell: a low sine on the key's root that settles a little in pitch
    const root = nearestNote(110 * pitch) / 2;
    const swell = ac.createOscillator();
    swell.type = 'sine';
    swell.frequency.setValueAtTime(root * 1.06, t);
    swell.frequency.setTargetAtTime(root, t, 0.25);
    const swellGain = ac.createGain();
    envelope(swellGain.gain, t, 0.08, 2 + 1.5 * intensity, vol * 0.7);
    swell.connect(swellGain).connect(out);
    sources.push(swell);

    // singing bowl: inharmonic partials, each a pair a hair apart so it beats
    const note = nearestNote(220 * pitch);
    const PARTIALS = [[1, 0.09, 5], [2.71, 0.03, 3], [5.15, 0.012, 1.6]];
    for (const [ratio, level, decay] of PARTIALS) {
      for (const detune of [1, 1.0025]) {
        const osc = ac.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = note * ratio * detune;
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t); // silent until its envelope starts
        envelope(g.gain, t + 0.05, 0.15, decay, vol * level);
        osc.connect(g).connect(out);
        sources.push(osc);
      }
    }

    for (const src of sources) {
      src.start(t);
      src.stop(end);
    }
    const voice = { start: t, fader, sources };
    voices.push(voice);
    swell.onended = () => { voices = voices.filter((v) => v !== voice); };
  }

  function release(voice, t) {
    voice.fader.gain.setTargetAtTime(0, t, 0.05);
    for (const src of voice.sources) src.stop(t + 0.3);
  }

  // The stars' voices, updated every frame.
  //   stars: [{ root, speed, pan }] — root: the star's note in Hz; speed: its
  //          speed relative to the others' average (1 = average)
  //   on:    false fades them all out (paused, restarting)
  // A drone barely changes pitch: speed shows in its brightness, its swell
  // and the air, all following the star over a second or two.
  const HUM_GLIDE = 0.6;  // s — time constant; settles in about three of these
  function hum(stars, on) {
    if (!enabled || !ac) return;
    const t = ac.currentTime;
    hums.forEach((h, i) => {
      const s = stars[i];
      if (!s || !on) {
        h.gain.gain.setTargetAtTime(0, t, 0.5);
        return;
      }
      const r = Math.max(0.3, Math.min(3, s.speed));
      const fast = Math.min(1, r / 2.5);
      const freq = s.root * r ** 0.06; // twice as fast → under a semitone higher
      for (const { osc, ratio } of h.oscs) osc.frequency.setTargetAtTime(freq * ratio, t, HUM_GLIDE * 2);
      h.filter.frequency.setTargetAtTime(160 + 700 * fast ** 1.5, t, HUM_GLIDE);
      h.band.frequency.setTargetAtTime(freq * 6, t, HUM_GLIDE * 2);
      h.airGain.gain.setTargetAtTime(0.5 * fast ** 2, t, HUM_GLIDE);
      h.gain.gain.setTargetAtTime(0.045 * (0.5 + 0.5 * fast), t, HUM_GLIDE);
      h.out.pan.setTargetAtTime(s.pan, t, HUM_GLIDE);
    });
  }

  return {
    setEnabled,
    flyby,
    hum,
    get enabled() { return enabled; },
  };
})();
