// ---------------------------------------------------------------------------
// Bloom: bright light bleeds softly into its surroundings, as in a camera. The
// scene is drawn into a half-float texture, so light that adds up past white —
// star cores, flashes, crossing trails — keeps its brightness. That excess is
// picked out with a soft threshold, blurred through a chain of ever smaller
// copies (dual Kawase: down, then back up, adding each level), and added on top
// of the scene, which itself is clipped to white as the 2D canvas used to be.
// Together they roll off softly into white.
// ---------------------------------------------------------------------------
import {
  HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderTarget,
} from 'three';
import { ADD, OVER, material } from './common.js';

const LEVELS = 6;        // each half the size of the one before
const THRESHOLD = 0.6;   // brightness where bloom starts…
const KNEE = 0.3;        // …easing in over this range rather than switching on
const STRENGTH = 0.9;
const SPREAD = 0.55;     // each wider level adds this much less: glare fades with distance

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy + 0.5;
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

// Five taps: the centre and four diagonal half-texel neighbours, which the
// bilinear filter turns into a 4 × 4 average.
const DOWN = /* glsl */ `
  vec3 down(sampler2D map, vec2 uv, vec2 texel) {
    vec2 h = texel * 0.5;
    return (texture2D(map, uv).rgb * 4.0
      + texture2D(map, uv - h).rgb + texture2D(map, uv + h).rgb
      + texture2D(map, uv + vec2(h.x, -h.y)).rgb + texture2D(map, uv - vec2(h.x, -h.y)).rgb) / 8.0;
  }
`;

// Only the part of the light above the threshold, with a quadratic knee. Very
// bright light is compressed, so a flash on top of two star cores glows, rather
// than swallowing everything around it in white.
const prefilterFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  varying vec2 vUv;
  ${DOWN}
  void main() {
    vec3 c = down(uMap, vUv, uTexel);
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - ${(THRESHOLD - KNEE).toFixed(4)}, 0.0, ${(2 * KNEE).toFixed(4)});
    soft = soft * soft / ${(4 * KNEE).toFixed(4)};
    float w = max(soft, br - ${THRESHOLD.toFixed(4)}) / max(br, 1e-4);
    c *= w;
    gl_FragColor = vec4(c / (1.0 + 0.6 * max(c.r, max(c.g, c.b))), 1.0);
  }
`;

const downFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  varying vec2 vUv;
  ${DOWN}
  void main() { gl_FragColor = vec4(down(uMap, vUv, uTexel), 1.0); }
`;

// Eight taps in a ring around the pixel, weighted towards the diagonals.
const upFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  varying vec2 vUv;
  const float SPREAD = ${SPREAD.toFixed(4)};
  void main() {
    vec2 h = uTexel * 0.5;
    vec3 c = texture2D(uMap, vUv + vec2(-h.x * 2.0, 0.0)).rgb
      + texture2D(uMap, vUv + vec2(-h.x, h.y)).rgb * 2.0
      + texture2D(uMap, vUv + vec2(0.0, h.y * 2.0)).rgb
      + texture2D(uMap, vUv + vec2(h.x, h.y)).rgb * 2.0
      + texture2D(uMap, vUv + vec2(h.x * 2.0, 0.0)).rgb
      + texture2D(uMap, vUv + vec2(h.x, -h.y)).rgb * 2.0
      + texture2D(uMap, vUv + vec2(0.0, -h.y * 2.0)).rgb
      + texture2D(uMap, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    gl_FragColor = vec4(c / 12.0 * SPREAD, 1.0);
  }
`;

// Up to 0.8 the picture is unchanged; above, it rolls off smoothly into white
// instead of clipping, so overlapping light keeps some shape.
const compositeFragment = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  varying vec2 vUv;
  vec3 shoulder(vec3 x) {
    return mix(x, 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)), step(0.8, x));
  }
  void main() {
    vec3 scene = min(texture2D(uScene, vUv).rgb, 1.0);
    gl_FragColor = vec4(shoulder(scene + texture2D(uBloom, vUv).rgb * ${STRENGTH.toFixed(4)}), 1.0);
  }
`;

const target = () => new WebGLRenderTarget(1, 1, {
  type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
});

export class Bloom {
  constructor(gl) {
    this.gl = gl;
    this.scene = target();
    this.levels = Array.from({ length: LEVELS }, target);
    const pass = (fragmentShader, uniforms, blend = OVER) => material({ vertexShader, fragmentShader, uniforms, blend });
    this.prefilter = pass(prefilterFragment, { uMap: { value: null }, uTexel: { value: [1, 1] } });
    this.down = pass(downFragment, { uMap: { value: null }, uTexel: { value: [1, 1] } });
    this.up = pass(upFragment, { uMap: { value: null }, uTexel: { value: [1, 1] } }, ADD);
    this.composite = pass(compositeFragment, { uScene: { value: this.scene.texture }, uBloom: { value: this.levels[0].texture } });
    // the passes draw a single full-screen quad
    this.quad = new Mesh(new PlaneGeometry(1, 1), this.prefilter);
    this.quad.frustumCulled = false;
    this.passScene = new Scene().add(this.quad);
    this.passCamera = new OrthographicCamera();
  }

  setSize(w, h) {
    this.scene.setSize(w, h);
    this.levels.forEach((t, i) => {
      const k = 2 ** (i + 1);
      t.setSize(Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)));
    });
  }

  pass(mat, from, to, clear = true) {
    if (mat.uniforms.uMap) {
      mat.uniforms.uMap.value = from.texture;
      mat.uniforms.uTexel.value = [1 / from.width, 1 / from.height];
    }
    this.quad.material = mat;
    const gl = this.gl;
    gl.setRenderTarget(to);
    const autoClear = gl.autoClear;
    gl.autoClear = clear;
    gl.render(this.passScene, this.passCamera);
    gl.autoClear = autoClear;
  }

  render(scene, camera) {
    const gl = this.gl, lv = this.levels;
    gl.setRenderTarget(this.scene);
    gl.render(scene, camera);
    this.pass(this.prefilter, this.scene, lv[0]);
    for (let i = 1; i < LEVELS; i++) this.pass(this.down, lv[i - 1], lv[i]);
    // back up, each level adding the blurrier one below it onto itself
    for (let i = LEVELS - 1; i > 0; i--) this.pass(this.up, lv[i], lv[i - 1], false);
    this.pass(this.composite, null, null);
  }
}
