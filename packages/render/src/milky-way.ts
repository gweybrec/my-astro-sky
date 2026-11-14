/**
 * The Milky Way under the stars: an all-sky picture (equirectangular, RA/Dec) drawn by a
 * full-screen WebGL pass that turns each screen pixel back into RA/Dec with the active
 * projection (pole-centred stereographic or fisheye, north or south, or zenith-centred
 * local sky) and reads the picture there. The result is drawn onto the sky canvas with
 * "screen" blending, so the picture's black adds nothing and the band brightens the sky.
 *
 * The picture is NASA's "Deep Star Maps 2020" Milky Way layer (no stars: the map draws
 * its own), credit NASA/Goddard Space Flight Center Scientific Visualization Studio, with
 * Gaia DR2 data by ESA/Gaia/DPAC. Its layout: RA 0h in the middle, RA increasing to the
 * left, Dec +90° at the top.
 */
import type { ViewState } from '@myastrosky/core/types';
import {
  getCenterMode,
  getHemisphere,
  getProjectionMode,
  getProjectionObserver,
} from '@myastrosky/core/projection';
import { logDebug } from '@myastrosky/core/platform/log';

/** Where both apps serve the picture from (`public/data/`). */
export const MILKY_WAY_URL = '/data/milkyway.jpg';

/**
 * The pass is drawn at most at CSS-pixel resolution: the band is soft, and on a phone
 * (pixel ratio ~3) this saves most of the work at no visible cost.
 */
const MAX_PIXEL_RATIO = 1;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;      // CSS px of the view
uniform vec2 uRes;       // drawing-buffer px
uniform vec2 uCenter;    // view centre, projection units
uniform float uScale;    // px per projection unit
uniform vec2 uRot;       // cos, sin of the view rotation
uniform float uFisheye;  // 1 = orthographic radial form
uniform float uZenith;   // 1 = zenith-centred (local sky)
uniform float uSouth;    // 1 = south pole at the centre
uniform float uLst;      // local sidereal time, radians
uniform float uLat;      // observer latitude, radians
uniform float uGain;     // brightness multiplier
uniform float uBlack;    // picture level treated as black (cuts the faint haze)
const float PI = 3.14159265358979;

void main() {
  // Canvas px (y down), as fromCanvas() in projection.ts.
  vec2 c = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * (uSize / uRes);
  vec2 r = c - 0.5 * uSize;
  float dx = r.x * uRot.x - r.y * uRot.y;
  float dy = r.x * uRot.y + r.y * uRot.x;
  vec2 p = vec2(uCenter.x + dx / uScale, uCenter.y - dy / uScale);
  float rad = length(p);

  // Angle from the projection centre (pole or zenith), as unproject().
  float ang;
  if (uFisheye > 0.5) {
    if (rad > 1.0) discard;
    ang = asin(rad);
  } else {
    ang = 2.0 * atan(rad);
  }

  float ra;
  float dec;
  if (uZenith > 0.5) {
    float alt = 0.5 * PI - ang;
    float az = atan(-p.x, p.y);
    float sinDec = sin(uLat) * sin(alt) + cos(uLat) * cos(alt) * cos(az);
    dec = asin(clamp(sinDec, -1.0, 1.0));
    float ha = atan(-cos(alt) * sin(az), cos(uLat) * sin(alt) - sin(uLat) * cos(alt) * cos(az));
    ra = uLst - ha;
  } else {
    ra = atan(p.x, p.y);
    dec = uSouth > 0.5 ? ang - 0.5 * PI : 0.5 * PI - ang;
  }

  vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), (0.5 * PI - dec) / PI);
  vec3 rgb = max(texture2D(uTex, uv).rgb - uBlack, 0.0) / (1.0 - uBlack);
  gl_FragColor = vec4(rgb * uGain, 1.0);
}`;

export class MilkyWayLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly loc: Record<string, WebGLUniformLocation | null>;
  private texture: WebGLTexture | null = null;
  private loading = false;
  private readonly onReady: () => void;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    onReady: () => void,
  ) {
    this.onReady = onReady;
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    const names = [
      'uTex',
      'uSize',
      'uRes',
      'uCenter',
      'uScale',
      'uRot',
      'uFisheye',
      'uZenith',
      'uSouth',
      'uLst',
      'uLat',
      'uGain',
      'uBlack',
    ];
    this.loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  /** Null without WebGL (the map then simply has no Milky Way). `onReady` asks for a redraw once the picture is in. */
  static create(onReady: () => void): MilkyWayLayer | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const program = linkProgram(gl);
    if (!program) return null;
    return new MilkyWayLayer(canvas, gl, program, onReady);
  }

  /**
   * Draw the Milky Way for `view` onto `ctx` (CSS-px transform), screen-blended at
   * `gain` brightness, with picture levels up to `black` (0..1) cut to black. Starts loading the picture on first use; draws nothing until it is in.
   */
  draw(ctx: CanvasRenderingContext2D, view: ViewState, gain: number, black: number): void {
    if (!this.texture) {
      this.load();
      return;
    }
    if (gain <= 0 || this.gl.isContextLost()) return;
    const gl = this.gl;
    const k = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(view.width * k));
    const h = Math.max(1, Math.round(view.height * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    const theta = (view.rotationDeg * Math.PI) / 180;
    const obs = getProjectionObserver();
    const L = this.loc;
    gl.uniform1i(L.uTex, 0);
    gl.uniform2f(L.uSize, view.width, view.height);
    gl.uniform2f(L.uRes, w, h);
    gl.uniform2f(L.uCenter, view.centerX, view.centerY);
    gl.uniform1f(L.uScale, view.scale);
    gl.uniform2f(L.uRot, Math.cos(theta), Math.sin(theta));
    gl.uniform1f(L.uFisheye, getProjectionMode() === 'fisheye' ? 1 : 0);
    gl.uniform1f(L.uZenith, getCenterMode() === 'zenith' ? 1 : 0);
    gl.uniform1f(L.uSouth, getHemisphere() === 'south' ? 1 : 0);
    gl.uniform1f(L.uLst, (obs.lstH * 15 * Math.PI) / 180);
    gl.uniform1f(L.uLat, (obs.latDeg * Math.PI) / 180);
    gl.uniform1f(L.uGain, gain);
    gl.uniform1f(L.uBlack, Math.min(0.9, Math.max(0, black)));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this.canvas, 0, 0, view.width, view.height);
    ctx.restore();
  }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    const img = new Image();
    img.onload = () => {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      // RA wraps around; no mipmaps (their level jumps at the wrap would draw a seam).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.texture = texture;
      this.onReady();
    };
    img.onerror = () => logDebug('MilkyWay', `picture not loaded: ${MILKY_WAY_URL}`);
    img.src = MILKY_WAY_URL;
  }
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      logDebug('MilkyWay', `shader: ${gl.getShaderInfoLog(s) ?? ''}`);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    logDebug('MilkyWay', `link: ${gl.getProgramInfoLog(program) ?? ''}`);
    return null;
  }
  return program;
}
