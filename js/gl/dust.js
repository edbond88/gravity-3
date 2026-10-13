// ---------------------------------------------------------------------------
// Dust on the GPU (bookkeeping in js/dust.js): the system flying through an
// interstellar cloud. Dust streams in from beyond the left edge of the view in
// an even wind; the stars bend it, focus it into bright wakes behind them and
// leave a shadow where they have swept it up. The wind is smooth and orderly,
// so what the stars do to it shows as clear structure, never as noise.
//
// Each grain is one pixel of a float texture holding its position and
// velocity (x, y, vx, vy in AU and AU/yr). A step is a shader pass reading one
// texture and writing the other: the three stars' pull, symplectic Euler, the
// step cut finer close to a star. Grains that leave the view on the right,
// stray too far up or down, fall into a star or get caught in orbit come back
// in on the left.
//
// Each grain is drawn as a short streak along its motion: parallel lines where
// the wind blows freely, curving round the stars. Their light adds up in a
// buffer of its own, laid over the scene through a soft ceiling (1 − e^−x):
// thin dust stays faint, dense wakes glow without burning out to white.
// ---------------------------------------------------------------------------
import {
  BufferAttribute, BufferGeometry, FloatType, HalfFloatType, LineSegments, Mesh, NearestFilter, NoBlending,
  OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget,
} from 'three';
import { CLEAR, SCREEN_VERTEX, material, quad } from './common.js';

// grains: SIZE × SIZE — a quarter as many on phones
const SIZE = Math.min(screen.width, screen.height) <= MOBILE_WIDTH ? 256 : 512;
const WIND = 4;            // AU/yr — how fast the dust blows in: slow enough for the stars to bend it well
const SOFT = 0.04;         // AU — softening of the stars' pull
const ABSORB = 0.06;       // AU — a grain this close to a star falls in
const CAPTURED = 0.3;      // years — grains the stars have caught in orbit are let go after about this long
const TAIL = 0.045;        // years of motion shown in each streak
const BRIGHTNESS = 0.13;
const CEILING = 0.5;       // the brightest dense dust gets
const f = (x) => x.toFixed(6);

const passVertex = /* glsl */ `
  void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const stepFragment = /* glsl */ `
  uniform sampler2D uState;
  uniform vec3 uBodies[3];  // x, y, mass
  uniform vec2 uVel[3];     // the stars' velocities
  uniform float uDt;        // years; 0 with a shift or a reseed
  uniform vec4 uShift;      // subtracted from every grain's state
  uniform float uReseed;
  uniform vec4 uView;       // the world the wind blows through: x from, x to, y from, y to (AU)
  uniform float uSeed;      // a fresh random integer each pass

  const float G = ${f(4 * Math.PI * Math.PI)};
  const float WIND = ${f(WIND)};
  const float EPS2 = ${f(SOFT * SOFT)};
  const float ABSORB2 = ${f(ABSORB * ABSORB)};

  // PCG hash: good-quality noise from integers. (A sin() hash shows stripes
  // across this many grains.)
  uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }
  float random(vec2 id, uint k) {
    uvec2 p = uvec2(id);
    return float(pcg(p.x + pcg(p.y + pcg(uint(uSeed) + k)))) / 4294967295.0;
  }

  // A grain riding the wind: anywhere across the view for a fresh cloud, or
  // somewhere in a reservoir off to the left, half a view wide. As many come
  // back each step as left — and that varies, since the stars have bunched
  // the wind up by the time it leaves on the right. Spread over the
  // reservoir, the ups and downs even out before they reach the screen,
  // instead of coming in as stripes.
  vec4 spawn(vec2 id, bool fill) {
    float u = random(id, 1u), v = random(id, 2u);
    float span = uView.y - uView.x;
    float x = fill ? mix(uView.x - 0.5 * span, uView.y, u) : uView.x - u * 0.5 * span;
    return vec4(x, mix(uView.z, uView.w, v), WIND, 0.0);
  }

  void main() {
    vec2 id = gl_FragCoord.xy;
    if (uReseed > 0.5) { gl_FragColor = spawn(id, true); return; }
    vec4 s = texture2D(uState, id / ${f(SIZE)}) - uShift;
    vec2 x = s.xy, v = s.zw;
    float left = uDt;
    bool dead = false;
    for (int i = 0; i < 64; i++) {
      if (left <= 0.0) break;
      vec2 acc = vec2(0.0);
      float h = left;
      for (int k = 0; k < 3; k++) {
        vec2 d = uBodies[k].xy - x;
        float r2 = dot(d, d);
        float m = uBodies[k].z;
        if (r2 < ABSORB2) dead = true;
        float e = r2 + EPS2;
        acc += d * (G * m / (e * sqrt(e)));
        h = min(h, 0.03 * sqrt(r2 * sqrt(r2) / (G * m)));
      }
      if (dead) break;
      h = max(h, 1e-5);
      v += acc * h;
      x += v * h;
      left -= h;
    }
    bool gone = x.x > uView.y || x.x < uView.x - (uView.y - uView.x) || x.y < uView.z || x.y > uView.w;
    // A grain a star has caught in orbit (bound to it: negative energy in the
    // star's own frame) would circle on in a tangle; let it go soon and come
    // back in with the wind, so what shows is the wind passing through and
    // being bent. (Bound to the system as a whole the slow wind always is —
    // that only means it falls towards the stars.)
    bool caught = false;
    for (int k = 0; k < 3; k++) {
      vec2 dv = v - uVel[k], d = uBodies[k].xy - x;
      caught = caught || 0.5 * dot(dv, dv) < G * uBodies[k].z / sqrt(dot(d, d) + EPS2);
    }
    bool renew = caught && random(id, 3u) < 1.0 - exp(-uDt / ${f(CAPTURED)});
    if (dead || gone || renew || any(isnan(x)) || any(isnan(v))) {
      gl_FragColor = spawn(id, false);
      return;
    }
    gl_FragColor = vec4(x, v);
  }
`;

// Each grain is two vertices, its streak's tail and head.
const drawVertex = /* glsl */ `
  attribute vec2 ref;       // which pixel of the state texture
  attribute float head;     // 1 at the head of the streak, 0 at its tail
  uniform sampler2D uState;
  uniform vec3 uCamera;     // centre x, y (px), scale (px per AU)
  uniform vec2 uOffset;     // camera offset, AU
  varying vec3 vColor;
  varying float vHead;
  void main() {
    vec4 s = texture2D(uState, ref);
    vec2 w = s.xy - s.zw * ${f(TAIL)} * (1.0 - head);
    vec2 p = uCamera.xy + (w + uOffset) * uCamera.z;
    // the wind's own speed is cool; flung faster by a star, it warms
    float fast = smoothstep(${f(WIND * 1.15)}, ${f(WIND * 3)}, length(s.zw));
    vColor = mix(vec3(0.55, 0.68, 1.0), vec3(1.0, 0.78, 0.55), fast);
    vHead = head;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const drawFragment = /* glsl */ `
  uniform float uBrightness;
  varying vec3 vColor;
  varying float vHead;
  void main() {
    gl_FragColor = vec4(vColor * uBrightness * vHead, 0.0);
  }
`;

const showFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uResolution;  // device pixels
  uniform float uOpacity;
  void main() {
    vec3 d = texture2D(uMap, gl_FragCoord.xy / uResolution).rgb;
    float peak = max(max(d.r, d.g), d.b);
    vec3 c = peak > 0.0 ? d / peak * (1.0 - exp(-peak)) : vec3(0.0);
    gl_FragColor = vec4(c * ${f(CEILING)} * uOpacity, 0.0);
  }
`;

const stateTarget = () => new WebGLRenderTarget(SIZE, SIZE, {
  type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false,
});

export class Dust {
  constructor(scene) {
    this.states = [stateTarget(), stateTarget()];
    this.current = 0;

    this.stepUniforms = {
      uState: { value: null }, uBodies: { value: new Array(9).fill(0) }, uVel: { value: new Array(6).fill(0) }, uDt: { value: 0 },
      uShift: { value: [0, 0, 0, 0] }, uReseed: { value: 0 }, uView: { value: [-10, 10, -10, 10] }, uSeed: { value: 0 },
    };
    // writes the state exactly, negative numbers and all: no blending
    const step = new ShaderMaterial({
      vertexShader: passVertex, fragmentShader: stepFragment, uniforms: this.stepUniforms,
      blending: NoBlending, depthTest: false, depthWrite: false,
    });
    const pass = new Mesh(new PlaneGeometry(1, 1), step);
    pass.frustumCulled = false;
    this.passScene = new Scene().add(pass);
    this.passCamera = new OrthographicCamera();

    const n = SIZE * SIZE;
    const ref = new Float32Array(n * 4), head = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const u = ((i % SIZE) + 0.5) / SIZE, v = (Math.floor(i / SIZE) + 0.5) / SIZE;
      ref.set([u, v, u, v], i * 4);
      head[i * 2 + 1] = 1;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3));
    geometry.setAttribute('ref', new BufferAttribute(ref, 2));
    geometry.setAttribute('head', new BufferAttribute(head, 1));
    this.drawUniforms = {
      uState: { value: null }, uCamera: { value: [0, 0, 1] }, uOffset: { value: [0, 0] }, uBrightness: { value: BRIGHTNESS },
    };
    this.streaks = new LineSegments(geometry, material({
      vertexShader: drawVertex, fragmentShader: drawFragment, uniforms: this.drawUniforms,
    }));
    this.streaks.frustumCulled = false;
    this.drawScene = new Scene().add(this.streaks);
    this.light = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });

    this.showUniforms = { uMap: { value: this.light.texture }, uResolution: { value: [1, 1] }, uOpacity: { value: 1 } };
    this.show = quad(material({ vertexShader: SCREEN_VERTEX, fragmentShader: showFragment, uniforms: this.showUniforms }));
    scene.add(this.show);
  }

  setSize() {
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    this.light.setSize(w, h);
    this.showUniforms.uResolution.value = [w, h];
  }

  // The stretch of world the wind blows through: the view, with room above
  // and below so zooming out doesn't open empty bands, and a little to the
  // right so grains leave the screen before they turn back up on the left.
  // The inlet on the left and the band's top and bottom stay put as the
  // camera eases in and out — were they to follow it, each frame's grains
  // would come in overlapping or short of the last, in stripes — and only
  // ever move out, when the view grows. A fresh cloud starts them over.
  view(fresh) {
    const x0 = toWorldX(0), x1 = toWorldX(width), y0 = toWorldY(0), y1 = toWorldY(height);
    const w = x1 - x0, h = y1 - y0;
    const want = [x0 - 0.05 * w, x1 + 0.1 * w, y0 - 0.3 * h, y1 + 0.3 * h];
    const had = this.extent;
    this.extent = fresh || !had ? want : [Math.min(had[0], want[0]), want[1], Math.min(had[2], want[2]), Math.max(had[3], want[3])];
    return this.extent;
  }

  // One pass: from the current state into the other.
  pass(gl) {
    const u = this.stepUniforms;
    u.uState.value = this.states[this.current].texture;
    u.uSeed.value = Math.floor(Math.random() * 1e6);
    this.current ^= 1;
    gl.setRenderTarget(this.states[this.current]);
    gl.render(this.passScene, this.passCamera);
  }

  // Runs the steps the simulation has queued since the last frame.
  // view: the renderer's three.js camera (`camera` is the app's own)
  update(opacity, gl, view) {
    this.show.visible = showDust;
    if (!showDust || !camera.scale) return;
    const u = this.stepUniforms;
    u.uView.value = this.view(dust.reseed);
    if (dust.reseed) {
      u.uReseed.value = 1;
      this.pass(gl);
      u.uReseed.value = 0;
      dust.reseed = false;
    }
    for (const job of dust.queue) {
      if (job.shift) {
        u.uShift.value = job.shift; u.uDt.value = 0;
      } else {
        u.uShift.value = [0, 0, 0, 0]; u.uDt.value = job.dt;
        u.uBodies.value = job.bodies.flatMap((b) => b.slice(0, 3));
        u.uVel.value = job.bodies.flatMap((b) => b.slice(3));
      }
      this.pass(gl);
    }
    dust.queue = [];
    u.uShift.value = [0, 0, 0, 0];

    const d = this.drawUniforms;
    d.uState.value = this.states[this.current].texture;
    d.uCamera.value = [camera.cx, camera.cy, camera.scale];
    d.uOffset.value = [camera.ox, camera.oy];
    this.showUniforms.uOpacity.value = opacity;

    gl.setRenderTarget(this.light);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(this.drawScene, view);
    gl.setClearColor(CLEAR, 1);
    gl.setRenderTarget(null);
  }
}
