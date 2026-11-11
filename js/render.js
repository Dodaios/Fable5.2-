/* Rendering: field views (dye, vorticity, speed, pressure, temperature),
 * particle streaks and velocity arrows. */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});
  const S = NS.shaders;

  // colour maps (control points; the same data feeds the shaders and the legend)
  const CMAPS = {
    inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
    viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const BG = [0.016, 0.022, 0.036];
  const DIV_NEG = [0.10, 0.50, 1.00];   // negative: blue
  const DIV_POS = [1.00, 0.40, 0.10];   // positive: orange-red

  /** Diverging map, t in [-1,1] – identical to the GLSL function divMap. */
  function divColor(t) {
    const a = Math.pow(Math.min(Math.abs(t), 1), 0.75);
    const c = t >= 0 ? DIV_POS : DIV_NEG;
    const k1 = Math.min(a * 1.6, 1), k2 = Math.max(a * 1.6 - 1, 0) * 0.75;
    return [0, 1, 2].map((i) => { const m = BG[i] + (c[i] - BG[i]) * k1; return m + (1 - m) * k2; });
  }
  function seqColor(name, t) {
    const st = CMAPS[name].map(hex);
    const x = Math.min(Math.max(t, 0), 1) * (st.length - 1);
    const k = Math.min(Math.floor(x), st.length - 2), f = x - k;
    return [0, 1, 2].map((i) => st[k][i] * (1 - f) + st[k + 1][i] * f);
  }

  const VIZ = S.HEAD + S.COMMON + `
uniform sampler2D uVel;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float w = (fetchV(uVel, c) - fetchV(uVel, c + ivec2(-1, 0))) - (fetchU(uVel, c) - fetchU(uVel, c + ivec2(0, -1)));
  float sp = 0.0;
  if (c.x < uN.x && c.y < uN.y) {
    vec2 q = texelFetch(uVel, c, 0).xy;
    sp = length(vec2(0.5 * (q.x + fetchU(uVel, c + ivec2(1, 0))), 0.5 * (q.y + fetchV(uVel, c + ivec2(0, 1)))));
  }
  o = vec4(w, sp, 0.0, 1.0);
}
`;

  const DISPLAY = S.HEAD + `
uniform sampler2D uScal;
uniform sampler2D uViz;
uniform sampler2D uPres;
uniform sampler2D uMask;
uniform ivec2 uN;
uniform ivec2 uPer;
uniform vec2 uRes;
uniform int uView;        // 0 dye, 1 vorticity, 2 speed, 3 pressure, 4 temperature
uniform vec2 uRange;      // scale 1/range, zero point
uniform vec3 uCmap[10];
uniform vec3 uBg;
uniform vec3 uDivNeg;
uniform vec3 uDivPos;
uniform float uDyeGain;
uniform int uSmooth;
out vec4 o;

ivec2 wrapC(ivec2 q) {
  if (uPer.x == 1) { if (q.x < 0) q.x += uN.x; else if (q.x >= uN.x) q.x -= uN.x; } else q.x = clamp(q.x, 0, uN.x - 1);
  if (uPer.y == 1) { if (q.y < 0) q.y += uN.y; else if (q.y >= uN.y) q.y -= uN.y; } else q.y = clamp(q.y, 0, uN.y - 1);
  return q;
}
vec4 bilinC(sampler2D t, vec2 pos) {
  vec2 x = pos - 0.5;
  ivec2 i = ivec2(floor(x));
  vec2 f = x - vec2(i);
  if (uSmooth == 0) return texelFetch(t, wrapC(ivec2(floor(pos))), 0);
  return mix(mix(texelFetch(t, wrapC(i), 0), texelFetch(t, wrapC(i + ivec2(1, 0)), 0), f.x),
             mix(texelFetch(t, wrapC(i + ivec2(0, 1)), 0), texelFetch(t, wrapC(i + ivec2(1, 1)), 0), f.x), f.y);
}
vec4 bsplineC(sampler2D t, vec2 pos) {
  vec2 x = pos - 0.5;
  ivec2 i = ivec2(floor(x));
  vec2 f = x - vec2(i);
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  float wx[4] = float[4](w0.x, w1.x, w2.x, w3.x);
  float wy[4] = float[4](w0.y, w1.y, w2.y, w3.y);
  vec4 s = vec4(0.0);
  for (int b = 0; b < 4; b++) for (int a = 0; a < 4; a++) {
    s += wx[a] * wy[b] * texelFetch(t, wrapC(i + ivec2(a - 1, b - 1)), 0);
  }
  return s;
}
// node values (vorticity) sit on integer coordinates; the texture has (Nx+1) x (Ny+1) texels
float bilinVtx(sampler2D t, vec2 pos) {
  ivec2 i = ivec2(floor(pos));
  vec2 f = pos - vec2(i);
  ivec2 hi = uN;
  ivec2 a = clamp(i, ivec2(0), hi), b = clamp(i + 1, ivec2(0), hi);
  if (uPer.x == 1) { a.x = a.x % uN.x; b.x = b.x % uN.x; }
  if (uPer.y == 1) { a.y = a.y % uN.y; b.y = b.y % uN.y; }
  if (uSmooth == 0) { f = step(0.5, f); }
  return mix(mix(texelFetch(t, a, 0).x, texelFetch(t, ivec2(b.x, a.y), 0).x, f.x),
             mix(texelFetch(t, ivec2(a.x, b.y), 0).x, texelFetch(t, b, 0).x, f.x), f.y);
}
vec3 seqMap(float t) {
  float x = clamp(t, 0.0, 1.0) * 9.0;
  int k = min(int(floor(x)), 8);
  return mix(uCmap[k], uCmap[k + 1], x - float(k));
}
vec3 divMap(float t) {
  float a = pow(min(abs(t), 1.0), 0.75);
  vec3 c = t >= 0.0 ? uDivPos : uDivNeg;
  vec3 m = mix(uBg, c, min(a * 1.6, 1.0));
  return mix(m, vec3(1.0), max(a * 1.6 - 1.0, 0.0) * 0.75);
}
void main() {
  vec2 pos = gl_FragCoord.xy / uRes * vec2(uN);
  vec3 col;
  if (uView == 0) {
    vec3 d = max((uSmooth == 1 ? bsplineC(uScal, pos) : bilinC(uScal, pos)).rgb, 0.0);
    vec3 e = 1.0 - exp(-uDyeGain * d);
    col = uBg + (1.0 - uBg) * e;
  } else if (uView == 1) {
    col = divMap(bilinVtx(uViz, pos) * uRange.x);
  } else if (uView == 2) {
    col = seqMap(bilinC(uViz, pos).y * uRange.x);
  } else if (uView == 3) {
    col = divMap((bilinC(uPres, pos).x - uRange.y) * uRange.x);
  } else {
    col = divMap((bilinC(uScal, pos).a - uRange.y) * uRange.x);
  }
  // solid bodies
  float m = bilinC(uMask, pos).x;
  float edge = 1.0 - smoothstep(0.0, 0.22, abs(m - 0.5));
  vec3 solid = vec3(0.23, 0.26, 0.31) + 0.03 * sin(0.9 * (gl_FragCoord.x + gl_FragCoord.y));
  col = mix(col, solid, smoothstep(0.42, 0.58, m));
  col = mix(col, vec3(0.62, 0.68, 0.76), edge * step(0.02, m) * 0.9);
  o = vec4(col, 1.0);
}
`;

  // --- particles --------------------------------------------------------------
  const VEL_AT = `
vec2 velAt(vec2 x) {
  vec2 a = vec2(x.x, x.y - 0.5);
  ivec2 i = ivec2(floor(a));
  vec2 f = a - vec2(i);
  float u = mix(mix(fetchU(uVel, i), fetchU(uVel, i + ivec2(1, 0)), f.x),
                mix(fetchU(uVel, i + ivec2(0, 1)), fetchU(uVel, i + ivec2(1, 1)), f.x), f.y);
  a = vec2(x.x - 0.5, x.y);
  i = ivec2(floor(a));
  f = a - vec2(i);
  float v = mix(mix(fetchV(uVel, i), fetchV(uVel, i + ivec2(1, 0)), f.x),
                mix(fetchV(uVel, i + ivec2(0, 1)), fetchV(uVel, i + ivec2(1, 1)), f.x), f.y);
  return vec2(u, v);
}
`;

  const PART_UPDATE = S.HEAD + S.COMMON + `
uniform sampler2D uVel;
uniform sampler2D uPos;
uniform sampler2D uMask;
uniform float uDt;       // grid time of this frame
uniform float uAge;      // wall-clock time of this frame [s]
uniform float uSeed;
uniform int uReset;
out vec4 o;
` + VEL_AT + `
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 p = texelFetch(uPos, c, 0);
  vec2 dom = vec2(uN);
  vec2 x = p.xy;
  bool dead = uReset == 1;
  if (!dead) {
    vec2 v1 = velAt(x);
    vec2 v2 = velAt(clamp(x + 0.5 * uDt * v1, vec2(0.0), dom));
    x += uDt * v2;
    if (uBC.x == 2) x.x = mod(x.x, dom.x);
    if (uBC.z == 2) x.y = mod(x.y, dom.y);
    p.z += uAge;
    dead = p.z > p.w || x.x < 0.0 || x.y < 0.0 || x.x > dom.x || x.y > dom.y;
    if (!dead) dead = texelFetch(uMask, clamp(ivec2(floor(x)), ivec2(0), uN - 1), 0).x > 0.5;
  }
  if (dead) {
    vec2 h = hash2(vec2(c) + uSeed * vec2(17.13, 31.71));
    vec2 h2 = hash2(vec2(c).yx * 1.37 + uSeed * vec2(5.3, 9.1));
    x = h * dom;
    p.z = uReset == 1 ? h2.x * 4.0 : 0.0;
    p.w = 2.5 + 4.0 * h2.y;
  }
  o = vec4(x, p.z, p.w);
}
`;

  const VS_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

  const PART_VS = VS_HEAD + S.COMMON + `
uniform sampler2D uVel;
uniform sampler2D uPos;
uniform int uSide;       // side length of the particle texture
uniform float uStreak;   // streak length [cells per unit velocity]
uniform vec2 uPx;        // pixel size in clip coordinates
uniform float uWidth;    // width in pixels
out float vAlpha;
out vec2 vUV;
` + VEL_AT + `
void main() {
  int id = gl_InstanceID;
  vec4 p = texelFetch(uPos, ivec2(id % uSide, id / uSide), 0);
  vec2 v = velAt(p.xy);
  vec2 head = p.xy / vec2(uN) * 2.0 - 1.0;
  vec2 tail = (p.xy - v * uStreak) / vec2(uN) * 2.0 - 1.0;
  vec2 d = (head - tail) / uPx;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float cx = float(gl_VertexID & 1), cy = float((gl_VertexID >> 1) & 1);
  float hw = 0.5 * uWidth;
  vec2 off = dir * (mix(-len - hw, hw, cx)) + nrm * ((cy * 2.0 - 1.0) * hw);
  gl_Position = vec4(head + off * uPx, 0.0, 1.0);
  float life = p.z / p.w;
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.75, 1.0, life));
  vUV = vec2(cx, cy * 2.0 - 1.0);
}
`;
  const PART_FS = S.HEAD + `
in float vAlpha;
in vec2 vUV;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 o;
void main() {
  float a = vAlpha * uOpacity * (0.25 + 0.75 * vUV.x) * (1.0 - vUV.y * vUV.y);
  o = vec4(uColor * a, a);
}
`;

  // --- arrows -----------------------------------------------------------------
  const ARROW_VS = VS_HEAD + S.COMMON + `
uniform sampler2D uVel;
uniform ivec2 uGrid;     // arrows in x, y
uniform float uScale;    // 1 / reference velocity
uniform vec2 uPx;
uniform float uCell;     // arrow spacing in pixels
out float vA;
` + VEL_AT + `
void main() {
  int id = gl_InstanceID;
  vec2 g = (vec2(float(id % uGrid.x), float(id / uGrid.x)) + 0.5) / vec2(uGrid);
  vec2 x = g * vec2(uN);
  vec2 v = velAt(x);
  float sp = length(v);
  float L = uCell * 0.95 * clamp(sp * uScale, 0.0, 1.0);
  vec2 dir = sp > 1e-9 ? v / sp : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = max(0.75, uCell * 0.035);
  float hl = min(L * 0.45, uCell * 0.26), hw = hl * 0.55;
  // 9 vertices: shaft (2 triangles) + head
  vec2 q;
  int k = gl_VertexID;
  if (k == 0) q = vec2(0.0, -w); else if (k == 1) q = vec2(L - hl, -w); else if (k == 2) q = vec2(L - hl, w);
  else if (k == 3) q = vec2(0.0, -w); else if (k == 4) q = vec2(L - hl, w); else if (k == 5) q = vec2(0.0, w);
  else if (k == 6) q = vec2(L - hl, -hw); else if (k == 7) q = vec2(L, 0.0); else q = vec2(L - hl, hw);
  q.x -= 0.5 * L;
  vec2 c = g * 2.0 - 1.0;
  gl_Position = vec4(c + (dir * q.x + nrm * q.y) * uPx, 0.0, 1.0);
  vA = smoothstep(0.01, 0.06, sp * uScale);
}
`;
  const ARROW_FS = S.HEAD + `
in float vA;
uniform vec3 uColor;
out vec4 o;
void main() { o = vec4(uColor * vA * 0.85, vA * 0.85); }
`;

  class Renderer {
    constructor(glx, solver) {
      this.glx = glx;
      this.solver = solver;
      this.prog = {
        viz: glx.program(VIZ, 'viz'),
        display: glx.program(DISPLAY, 'display'),
        partUpdate: glx.program(PART_UPDATE, 'particle-update'),
        partDraw: glx.program(PART_FS, 'particle-draw', PART_VS),
        arrows: glx.program(ARROW_FS, 'arrows', ARROW_VS),
      };
      this.viz = null;
      this.pos = null; this.posB = null;
      this.side = 0;
      this.seed = 1;
      this.needReset = true;
    }

    /** call after solver.configure */
    resize(particleCount) {
      const glx = this.glx, s = this.solver;
      glx.free(this.viz); glx.free(this.pos); glx.free(this.posB);
      this.viz = glx.target(s.nx + 1, s.ny + 1, 'rgba');
      this.side = Math.max(16, Math.round(Math.sqrt(particleCount || 16384)));
      this.pos = glx.target(this.side, this.side, 'rgba');
      this.posB = glx.target(this.side, this.side, 'rgba');
      this.needReset = true;
    }

    updateParticles(gridDt, wallDt) {
      const s = this.solver;
      this.seed = (this.seed * 1.618 + 0.37) % 97;
      this.prog.partUpdate.use({
        uVel: s.u, uPos: this.pos, uMask: s.mask, uDt: gridDt, uAge: wallDt,
        uSeed: this.seed, uReset: this.needReset ? 1 : 0,
      });
      this.glx.draw(this.posB);
      const t = this.pos; this.pos = this.posB; this.posB = t;
      this.needReset = false;
    }

    /** opts: {view, range:[inv, zero], cmap, dyeGain, smooth, particles, arrows, arrowScale, streak} */
    render(opts) {
      const glx = this.glx, gl = glx.gl, s = this.solver;
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      if (opts.view === 1 || opts.view === 2) {
        this.prog.viz.use({ uVel: s.u });
        glx.draw(this.viz);
      }
      const cm = new Float32Array(30);
      CMAPS[opts.cmap || 'inferno'].forEach((h, k) => cm.set(hex(h), 3 * k));
      this.prog.display.use({
        uScal: s.s, uViz: this.viz, uPres: s.p, uMask: s.mask,
        uN: [s.nx, s.ny], uPer: [s.perX ? 1 : 0, s.perY ? 1 : 0], uRes: [W, H],
        uView: opts.view, uRange: opts.range || [1, 0], uCmap: cm, uBg: BG,
        uDivNeg: DIV_NEG, uDivPos: DIV_POS, uDyeGain: opts.dyeGain || 2.2, uSmooth: opts.smooth === false ? 0 : 1,
      });
      glx.draw(null);
      if (opts.particles || opts.arrows) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (opts.particles) {
          const bright = opts.view === 2;
          this.prog.partDraw.use({
            uVel: s.u, uPos: this.pos, uSide: this.side, uStreak: opts.streak || 6,
            uPx: [2 / W, 2 / H], uWidth: Math.max(1.5, H / 520),
            uColor: bright ? [0.75, 0.9, 1.0] : [1.0, 1.0, 1.0], uOpacity: opts.view === 0 ? 0.5 : 0.6,
          });
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.side * this.side);
        }
        if (opts.arrows) {
          const gy = opts.arrowRows || 18, gx = Math.round(gy * s.nx / s.ny);
          this.prog.arrows.use({
            uVel: s.u, uGrid: [gx, gy], uScale: opts.arrowScale || 1, uPx: [2 / W, 2 / H],
            uCell: H / gy, uColor: [1, 1, 1],
          });
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 9, gx * gy);
        }
        gl.disable(gl.BLEND);
      }
    }
  }

  NS.Renderer = Renderer;
  NS.colors = { divColor, seqColor, CMAPS, BG };
})();
