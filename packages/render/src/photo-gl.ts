/**
 * Draws the photos of the sky map with WebGL, each as a mesh of triangles that follows its sky model (see
 * `PhotoMesh` in `@myastrosky/core/photo-placement`): a photo of the sky is not an affine image of the map's
 * projection, so a single CSS matrix put wide fields up to tens of pixels off. The mesh is uploaded once per projection
 * change; panning and zooming only change one matrix per frame.
 */
import type { ViewState } from '@myastrosky/core/types';
import type { PhotoMesh } from '@myastrosky/core/photo-placement';
import { logDebug } from '@myastrosky/core/platform/log';

/** One photo to draw: `key` identifies it from frame to frame (its GPU buffers and picture are kept under it). */
export interface GlPhoto {
  key: object;
  image: HTMLImageElement;
  mesh: PhotoMesh;
  opacity: number;
}

/** What {@link PhotoGlRenderer.render} left undone. */
export interface GlRenderResult {
  /** Some pictures wait for their upload (a few per frame): draw again next frame. */
  pending: boolean;
  /** Photos whose picture WebGL may not read (another site's, without permission): draw them some other way. */
  failed: object[];
}

const VERTEX = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec4 uM;
uniform vec2 uT;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(uM.x * aPos.x + uM.y * aPos.y + uT.x, uM.z * aPos.x + uM.w * aPos.y + uT.y, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
void main() {
  gl_FragColor = texture2D(uTex, vUv) * uOpacity;
}`;

/** Pictures uploaded per frame: a large one takes a few milliseconds on a phone. */
const UPLOADS_PER_FRAME = 2;

interface Entry {
  mesh: PhotoMesh;
  positions: WebGLBuffer;
  uvs: WebGLBuffer;
  /** Origin of the positions (the photo's centre): kept out of the 32-bit floats so the photo stays sharp zoomed in. */
  origin: { x: number; y: number };
  texture: WebGLTexture | null;
  textureSrc: string;
}

export class PhotoGlRenderer {
  private gl: WebGLRenderingContext;
  private readonly webgl2: boolean;
  private program!: WebGLProgram;
  private loc!: {
    pos: number;
    uv: number;
    m: WebGLUniformLocation;
    t: WebGLUniformLocation;
    opacity: WebGLUniformLocation;
  };
  private entries = new Map<object, Entry>();
  private indices = new Map<number, { buffer: WebGLBuffer; count: number }>();
  private maxTextureSize = 4096;
  private lost = false;
  private readonly canvas: HTMLCanvasElement;

  /** A renderer drawing into `canvas`, or null where WebGL is not available. `onRestored`: draw again after a loss. */
  static create(canvas: HTMLCanvasElement, onRestored: () => void): PhotoGlRenderer | null {
    const options: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    };
    const gl2 = canvas.getContext('webgl2', options);
    const gl = gl2 ?? canvas.getContext('webgl', options);
    if (!gl) return null;
    try {
      return new PhotoGlRenderer(canvas, gl, gl2 !== null, onRestored);
    } catch (err) {
      logDebug('PhotoGl', `WebGL unusable: ${String(err)}`);
      return null;
    }
  }

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    webgl2: boolean,
    onRestored: () => void,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.webgl2 = webgl2;
    this.init();
    // A phone drops the GPU's state when the app goes to the background: everything is uploaded again.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.entries.clear();
      this.indices.clear();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.init();
      onRestored();
    });
  }

  private init(): void {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? '');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? '');
    }
    this.program = program;
    this.loc = {
      pos: gl.getAttribLocation(program, 'aPos'),
      uv: gl.getAttribLocation(program, 'aUv'),
      m: gl.getUniformLocation(program, 'uM')!,
      t: gl.getUniformLocation(program, 'uT')!,
      opacity: gl.getUniformLocation(program, 'uOpacity')!,
    };
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  /** Draws `photos` in order (the last on top) at `view`; the canvas is resized to the view first. */
  render(view: ViewState, photos: readonly GlPhoto[]): GlRenderResult {
    const result: GlRenderResult = { pending: false, failed: [] };
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(view.width * dpr));
    const h = Math.max(1, Math.round(view.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.lost || gl.isContextLost()) return result;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Projection → clip space, as toCanvas then the canvas → clip flip: a rotation and a scale.
    const theta = (view.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const sx = (2 * view.scale) / view.width;
    const sy = (2 * view.scale) / view.height;
    const m = [sx * cos, -sx * sin, sy * sin, sy * cos];
    gl.uniform4f(this.loc.m, m[0], m[1], m[2], m[3]);

    let uploads = 0;
    for (const photo of photos) {
      const entry = this.entryFor(photo);
      const src = photo.image.currentSrc || photo.image.src;
      if (entry.textureSrc !== src) {
        if (uploads >= UPLOADS_PER_FRAME) {
          result.pending = true;
        } else {
          uploads++;
          if (!this.upload(entry, photo.image, src)) {
            result.failed.push(photo.key);
            continue;
          }
        }
      }
      if (!entry.texture) continue;
      const ox = entry.origin.x - view.centerX;
      const oy = entry.origin.y - view.centerY;
      gl.uniform2f(this.loc.t, m[0] * ox + m[1] * oy, m[2] * ox + m[3] * oy);
      gl.uniform1f(this.loc.opacity, photo.opacity);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
      gl.enableVertexAttribArray(this.loc.pos);
      gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.uvs);
      gl.enableVertexAttribArray(this.loc.uv);
      gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
      const index = this.indexFor(entry.mesh.n);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.drawElements(gl.TRIANGLES, index.count, gl.UNSIGNED_SHORT, 0);
    }
    return result;
  }

  /** Frees what a photo holds on the GPU (it left the map, or its picture changed for good). */
  release(key: object): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    const gl = this.gl;
    gl.deleteBuffer(entry.positions);
    gl.deleteBuffer(entry.uvs);
    if (entry.texture) gl.deleteTexture(entry.texture);
    this.entries.delete(key);
  }

  /** Clears the canvas (no photo shown). */
  clear(): void {
    if (this.lost) return;
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private entryFor(photo: GlPhoto): Entry {
    const gl = this.gl;
    let entry = this.entries.get(photo.key);
    if (!entry) {
      entry = {
        mesh: photo.mesh,
        positions: gl.createBuffer()!,
        uvs: gl.createBuffer()!,
        origin: { x: 0, y: 0 },
        texture: null,
        textureSrc: '',
      };
      this.entries.set(photo.key, entry);
      this.uploadMesh(entry, photo.mesh, true);
    } else if (entry.mesh !== photo.mesh) {
      this.uploadMesh(entry, photo.mesh, entry.mesh.n !== photo.mesh.n);
    }
    return entry;
  }

  private uploadMesh(entry: Entry, mesh: PhotoMesh, uvsToo: boolean): void {
    const gl = this.gl;
    const { n, nodes, centroid } = mesh;
    entry.mesh = mesh;
    entry.origin = { x: centroid.x, y: centroid.y };
    const pos = new Float32Array(nodes.length);
    for (let k = 0; k < nodes.length; k += 2) {
      pos[k] = nodes[k] - centroid.x;
      pos[k + 1] = nodes[k + 1] - centroid.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    if (uvsToo) {
      const uv = new Float32Array(nodes.length);
      let k = 0;
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          uv[k++] = i / n;
          uv[k++] = j / n;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.uvs);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    }
  }

  private indexFor(n: number): { buffer: WebGLBuffer; count: number } {
    let index = this.indices.get(n);
    if (!index) {
      const gl = this.gl;
      const idx = new Uint16Array(n * n * 6);
      let k = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = j * (n + 1) + i;
          const b = a + 1;
          const c = a + n + 1;
          const d = c + 1;
          idx.set([a, b, c, b, d, c], k);
          k += 6;
        }
      }
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      index = { buffer, count: idx.length };
      this.indices.set(n, index);
    }
    return index;
  }

  /** Uploads the picture; false when WebGL may not read it. A picture larger than the GPU takes is scaled down. */
  private upload(entry: Entry, image: HTMLImageElement, src: string): boolean {
    const gl = this.gl;
    let source: TexImageSource = image;
    const max = this.maxTextureSize;
    if (image.naturalWidth > max || image.naturalHeight > max) {
      const k = max / Math.max(image.naturalWidth, image.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(image.naturalWidth * k));
      c.height = Math.max(1, Math.floor(image.naturalHeight * k));
      c.getContext('2d')?.drawImage(image, 0, 0, c.width, c.height);
      source = c;
    }
    const texture = entry.texture ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (err) {
      logDebug('PhotoGl', `picture not readable by WebGL: ${String(err)}`);
      gl.deleteTexture(texture);
      entry.texture = null;
      entry.textureSrc = src;
      return false;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.webgl2) {
      // Mipmaps keep a large picture shown small from shimmering (WebGL 1 has none for these sizes).
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    entry.texture = texture;
    entry.textureSrc = src;
    return true;
  }
}
