// ---------------------------------------------------------------------------
// Shared pieces of the WebGL renderer. Everything is drawn in CSS pixels with
// y pointing down, like the 2D canvas it replaces, so the camera's
// toScreenX/Y() place things directly. Shaders output premultiplied colour.
// ---------------------------------------------------------------------------
import {
  CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, ShaderMaterial,
} from 'three';

// Light adds up, like the canvas's 'lighter'; or is painted over, 'source-over'.
export const ADD = { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor };
export const OVER = { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor };

export function material({ vertexShader, fragmentShader, uniforms = {}, blend = ADD }) {
  return new ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    ...blend,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide, // y points down, which turns every triangle around
  });
}

// A unit quad centred on the origin; scale and move it into place.
const QUAD = new PlaneGeometry(1, 1);

export function quad(mat) {
  const mesh = new Mesh(QUAD, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// The quad's corners as offsets in pixels from its centre, for sprite shaders.
export const SPRITE_VERTEX = /* glsl */ `
  uniform float uSize;
  varying vec2 vPos;
  void main() {
    vPos = position.xy * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A full-screen pass that works in pixels from the top-left corner.
export const SCREEN_VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

export const rgb = (c) => c.map((v) => v / 255);

// What the screen is cleared to: the page background's darkest colour.
export const CLEAR = 0x04050b;
