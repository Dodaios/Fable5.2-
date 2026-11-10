/* Lichtgestalt: a hand-written raymarcher (WebGL 1, signed distance fields).
   Public API: Werkschau.shader.create(canvas, opts), also used by the page hero. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;
  if (!W) return;

  var SHAPES = ["Kugel", "Ring", "Kristall", "Knoten"];
  var STEPS = 56;
  var DIST = 4.6;
  var PITCH_MIN = -0.35;
  var PITCH_MAX = 1.25;
  var MIN_SCALE = 0.5;
  var DEFAULTS = { shape: 0, unrest: 0.45, speed: 1, gloss: 0.6 };
  var LIMITS = { shape: [0, SHAPES.length - 1], unrest: [0, 1], speed: [0, 2], gloss: [0, 1] };
  var FALLBACK = { body: "#ffc233", rim: "#cdd4ff", bg: "#e8ecf6", shade: "#1a29b4" };
  var TOKENS = { body: "--sun", rim: "--band-ink-2", bg: "--surface-2", shade: "--band-2" };

  var VERT = "attribute vec2 aPos;\nvoid main() {\n  gl_Position = vec4(aPos, 0.0, 1.0);\n}\n";

  /* GLSL stays ASCII-only: WebGL 1 rejects other characters in shader source. */
  var FRAG = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "",
    "uniform vec2 uRes;      // Canvas in Pixeln",
    "uniform float uTime;    // Sekunden, mit dem Tempo verrechnet",
    "uniform vec3 uCam;      // Kamera, kreist um den Ursprung",
    "uniform vec4 uW;        // Gewichte der vier Gestalten, Summe 1",
    "uniform float uUnrest;  // Unruhe 0..1",
    "uniform float uGloss;   // Glanz 0..1",
    "uniform vec3 uBody;     // Farben aus den Design-Tokens, linear",
    "uniform vec3 uRim;",
    "uniform vec3 uBg;",
    "uniform vec3 uShade;",
    "uniform float uClear;   // 1 = Hintergrund bleibt durchsichtig",
    "",
    "const int STEPS = " + STEPS + ";",
    "const float BOUND = 1.95;",
    "",
    "vec3 camU, camV, camW;",
    "",
    "mat2 rot(float a) {",
    "  float c = cos(a), s = sin(a);",
    "  return mat2(c, -s, s, c);",
    "}",
    "",
    "// Vier Abstandsformeln: negativ = innen, positiv = Abstand zur Form.",
    "float sdKugel(vec3 p) {",
    "  return length(p) - 1.08;",
    "}",
    "",
    "float sdRing(vec3 p) {",
    "  p.yz = rot(0.55) * p.yz;",
    "  return length(vec2(length(p.xz) - 0.92, p.y)) - 0.37;",
    "}",
    "",
    "float sdKristall(vec3 p) {",
    "  p = abs(p * vec3(1.0, 0.74, 1.0));",
    "  float s = 1.02;",
    "  float m = p.x + p.y + p.z - s;",
    "  vec3 q;",
    "  if (3.0 * p.x < m) q = p.xyz;",
    "  else if (3.0 * p.y < m) q = p.yzx;",
    "  else if (3.0 * p.z < m) q = p.zxy;",
    "  else return m * 0.57735 * 0.74 - 0.08;",
    "  float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);",
    "  return length(vec3(q.x, q.y - s + k, q.z - k)) * 0.74 - 0.08;",
    "}",
    "",
    "float sdKnoten(vec3 p) {",
    "  p.yz = rot(0.785) * p.yz;",
    "  p.xy = rot(0.35) * p.xy;",
    "  vec3 a = p - vec3(0.37, 0.0, 0.0);",
    "  vec3 b = p + vec3(0.37, 0.0, 0.0);",
    "  float d1 = length(vec2(length(a.xy) - 0.74, a.z)) - 0.21;",
    "  float d2 = length(vec2(length(b.xz) - 0.74, b.y)) - 0.21;",
    "  return min(d1, d2);",
    "}",
    "",
    "// Die Unruhe: ein paar verschobene Sinuswellen, die an der Form ziehen.",
    "float wobble(vec3 p) {",
    "  float t = uTime;",
    "  float a = sin(p.x * 2.6 + t * 1.3) * sin(p.y * 2.9 - t * 1.1) * sin(p.z * 2.3 + t * 0.9);",
    "  float b = sin(p.x * 5.1 - t * 1.7 + p.y * 1.3) * sin(p.z * 4.7 + t * 1.5);",
    "  return a + 0.45 * b;",
    "}",
    "",
    "// Die ganze Szene als eine Funktion: Abstand vom Punkt p zur Gestalt.",
    "float map(vec3 p) {",
    "  p.y -= 0.07 * sin(uTime * 0.8);",
    "  float d = 0.0;",
    "  if (uW.x > 0.0) d += uW.x * sdKugel(p);",
    "  if (uW.y > 0.0) d += uW.y * sdRing(p);",
    "  if (uW.z > 0.0) d += uW.z * sdKristall(p);",
    "  if (uW.w > 0.0) d += uW.w * sdKnoten(p);",
    "  float amp = 0.15 * dot(uW, vec4(1.0, 0.8, 0.8, 0.5));",
    "  return d + uUnrest * amp * wobble(p);",
    "}",
    "",
    "vec3 calcNormal(vec3 p) {",
    "  vec2 e = vec2(0.0025, -0.0025);",
    "  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +",
    "                   e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));",
    "}",
    "",
    "float softShadow(vec3 ro, vec3 rd) {",
    "  float res = 1.0;",
    "  float t = 0.06;",
    "  for (int i = 0; i < 18; i++) {",
    "    float h = map(ro + rd * t);",
    "    res = min(res, 7.0 * h / t);",
    "    t += clamp(h, 0.03, 0.25);",
    "    if (res < 0.01 || t > 3.2) break;",
    "  }",
    "  res = clamp(res, 0.0, 1.0);",
    "  return res * res * (3.0 - 2.0 * res);",
    "}",
    "",
    "float calcAO(vec3 p, vec3 n) {",
    "  float occ = 0.0;",
    "  float sca = 1.0;",
    "  for (int i = 0; i < 4; i++) {",
    "    float h = 0.03 + 0.11 * float(i);",
    "    occ += (h - map(p + n * h)) * sca;",
    "    sca *= 0.75;",
    "  }",
    "  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);",
    "}",
    "",
    "vec3 shade(vec3 p, vec3 rd) {",
    "  vec3 n = calcNormal(p);",
    "  vec3 l = normalize(camU * 0.55 + camV * 0.8 - camW * 0.5);",
    "  float diff = max(dot(n, l), 0.0);",
    "  float sh = softShadow(p + n * 0.02, l);",
    "  float ao = calcAO(p, n);",
    "  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);",
    "  vec3 h = normalize(l - rd);",
    "  float spec = pow(max(dot(n, h), 0.0), mix(18.0, 150.0, uGloss)) * (0.12 + 1.1 * uGloss);",
    "",
    "  vec3 warm = uBody * vec3(0.62, 0.34, 0.3);       // Schattenseite: Bernstein statt Grau",
    "  vec3 col = mix(warm, uBody, smoothstep(0.0, 0.85, diff * sh));",
    "  col *= mix(0.5, 1.0, ao);",
    "  col += uShade * 0.2 * max(-n.y, 0.0) * ao;       // kaltes Gegenlicht von unten",
    "  col += uRim * fres * (0.18 + 0.42 * uGloss);     // heller Rand",
    "  col += vec3(1.0, 0.97, 0.9) * spec * sh;         // Glanzlicht",
    "  return col;",
    "}",
    "",
    "vec3 background(vec3 ro, vec3 rd, vec2 uv) {",
    "  vec3 bg = uBg * mix(1.05, 0.9, smoothstep(0.1, 1.7, length(uv * vec2(0.75, 1.0))));",
    "  if (rd.y < -0.02) {                               // weicher Schatten am Boden",
    "    float tp = (-1.8 - ro.y) / rd.y;",
    "    float s = 1.0 - smoothstep(0.1, 1.8, length((ro + rd * tp).xz));",
    "    s *= 1.0 - smoothstep(-0.25, -0.02, rd.y);",
    "    bg = mix(bg, mix(bg * 0.5, uShade, 0.1), s * 0.4);",
    "  }",
    "  return bg;",
    "}",
    "",
    "void main() {",
    "  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);",
    "  vec3 ro = uCam;",
    "  camW = normalize(-ro);",
    "  camU = normalize(cross(camW, vec3(0.0, 1.0, 0.0)));",
    "  camV = cross(camU, camW);",
    "  vec3 rd = normalize(uv.x * camU + uv.y * camV + 2.6 * camW);",
    "",
    "  // Nur Strahlen, die die Kugel um die Szene treffen, werden verfolgt.",
    "  float b = dot(ro, rd);",
    "  float disc = b * b - dot(ro, ro) + BOUND * BOUND;",
    "  float minD = 1000.0;",
    "  float tMin = -b;",
    "  float hit = 0.0;",
    "  float t = 0.0;",
    "  if (disc > 0.0) {",
    "    float sq = sqrt(disc);",
    "    float tEnd = -b + sq;",
    "    float stepK = mix(0.92, 0.6, uUnrest);",
    "    t = -b - sq;",
    "    for (int i = 0; i < STEPS; i++) {",
    "      float d = map(ro + rd * t);",
    "      if (d < minD) { minD = d; tMin = t; }",
    "      if (d < 0.0012 * t) { hit = 1.0; break; }",
    "      t += d * stepK;",
    "      if (t > tEnd) break;",
    "    }",
    "  }",
    "",
    "  // Knapp verfehlte Strahlen decken das Pixel anteilig: glatte Kanten ohne Mehrfachabtastung.",
    "  float pixel = 3.0 / (2.6 * min(uRes.x, uRes.y));",
    "  float cov = hit > 0.5 ? 1.0 : clamp(1.0 - minD / (pixel * tMin), 0.0, 1.0);",
    "  float away = sqrt(max(dot(ro, ro) - b * b, 0.0));   // Abstand des Strahls zur Mitte",
    "  float halo = exp(-max(minD, 0.0) * 5.5) * (1.0 - smoothstep(1.2, 1.62, away));",
    "  vec3 body = vec3(0.0);",
    "  if (cov > 0.0) body = shade(ro + rd * (hit > 0.5 ? t : tMin), rd);",
    "",
    "  vec3 col;",
    "  float alpha;",
    "  if (uClear > 0.5) {",
    "    float glow = 0.22 * halo * (1.0 - cov);",
    "    alpha = cov + glow;",
    "    col = (body * cov + mix(uBody, vec3(1.0), 0.35) * glow) / max(alpha, 0.0001);",
    "  } else {",
    "    float dusk = 1.0 - clamp(dot(uBg, vec3(0.4)), 0.0, 1.0);",
    "    col = mix(background(ro, rd, uv) + uBody * 0.07 * halo * dusk, body, cov);",
    "    alpha = 1.0;",
    "  }",
    "  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));",
    "  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;",
    "  gl_FragColor = vec4(col * alpha, alpha);",
    "}",
    ""
  ].join("\n");

  /* ---------- pure helpers (unit-tested in tests/shader.test.mjs) ---------- */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function clampParams(p) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = p && p[k] != null ? Number(p[k]) : DEFAULTS[k];
      if (!isFinite(v)) v = DEFAULTS[k];
      out[k] = clamp(v, LIMITS[k][0], LIMITS[k][1]);
    });
    return out;
  }

  /* shape 1.25 -> 75 % Ring, 25 % Kristall */
  function shapeWeights(shape) {
    var s = clamp(Number(shape) || 0, 0, SHAPES.length - 1);
    return SHAPES.map(function (_, i) { return Math.max(0, 1 - Math.abs(s - i)); });
  }

  function mixWeights(a, b, t) {
    return a.map(function (v, i) { return v + (b[i] - v) * t; });
  }

  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function hexToRgb(str) {
    var s = String(str == null ? "" : str).trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [m[1], m[2], m[3]].map(function (v) { return clamp(Number(v) / 255, 0, 1); });
    return null;
  }

  function toLinear(rgb) { return rgb.map(function (c) { return Math.pow(c, 2.2); }); }

  /* Camera position on a sphere around the origin; yaw 0 looks down the -z axis. */
  function orbit(yaw, pitch, dist) {
    var p = clamp(pitch, PITCH_MIN, PITCH_MAX);
    return [dist * Math.cos(p) * Math.sin(yaw), dist * Math.sin(p), dist * Math.cos(p) * Math.cos(yaw)];
  }

  /* ---------- the renderer ---------- */
  function create(canvas, opts) {
    opts = opts || {};
    var transparent = !!opts.transparent;
    var interactive = !!opts.interactive;
    var maxDpr = opts.maxDpr || 1.5;
    var params = clampParams(Object.assign({}, DEFAULTS, opts.params));
    var weights = shapeWeights(params.shape);
    var morph = null;
    var cam = { yaw: opts.yaw != null ? opts.yaw : 0.7, pitch: opts.pitch != null ? opts.pitch : 0.3 };
    var gl = null, prog = null, vbuf = null, uni = null, colors = null;
    var running = opts.autoplay !== false;
    var motionOK = !W.reducedMotion();
    var visible = true, lost = false, destroyed = false, dragging = false;
    var raf = 0, last = 0, time = 0;
    var scale = 1, samples = [], acc = 0, fastWindows = 0, grew = false, mayGrow = true;
    var tooSlow = false, insisted = false;
    var fps = 0, fpsFrames = 0, fpsT0 = 0;
    var cleanups = [];

    function on(target, type, fn, o) {
      target.addEventListener(type, fn, o);
      cleanups.push(function () { target.removeEventListener(type, fn, o); });
    }

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("Lichtgestalt: Shader nicht kompiliert.", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    function setup() {
      var attrs = { alpha: transparent, premultipliedAlpha: true, antialias: false, depth: false, stencil: false };
      try { gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs); } catch (e) { gl = null; }
      if (!gl) return false;
      var vs = compile(gl.VERTEX_SHADER, VERT);
      var fs = vs && compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("Lichtgestalt: Programm nicht gelinkt.", gl.getProgramInfoLog(prog));
        return false;
      }
      gl.useProgram(prog);
      vbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uni = {};
      ["uRes", "uTime", "uCam", "uW", "uUnrest", "uGloss", "uBody", "uRim", "uBg", "uShade", "uClear"].forEach(function (n) {
        uni[n] = gl.getUniformLocation(prog, n);
      });
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      return true;
    }

    function readColors() {
      colors = {};
      Object.keys(TOKENS).forEach(function (k) {
        var rgb = null;
        try { rgb = hexToRgb(W.token(TOKENS[k], canvas)); } catch (e) { rgb = null; }
        colors[k] = toLinear(rgb || hexToRgb(FALLBACK[k]));
      });
    }

    function draw() {
      if (!gl || lost || destroyed) return;
      var c = orbit(cam.yaw, cam.pitch, DIST);
      gl.uniform2f(uni.uRes, canvas.width, canvas.height);
      gl.uniform1f(uni.uTime, time);
      gl.uniform3f(uni.uCam, c[0], c[1], c[2]);
      gl.uniform4f(uni.uW, weights[0], weights[1], weights[2], weights[3]);
      gl.uniform1f(uni.uUnrest, params.unrest);
      gl.uniform1f(uni.uGloss, params.gloss);
      gl.uniform3fv(uni.uBody, colors.body);
      gl.uniform3fv(uni.uRim, colors.rim);
      gl.uniform3fv(uni.uBg, colors.bg);
      gl.uniform3fv(uni.uShade, colors.shade);
      gl.uniform1f(uni.uClear, transparent ? 1 : 0);
      if (transparent) gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function live() { return running && motionOK && visible && !tooSlow && !lost && !destroyed; }

    function emit() {
      if (opts.onStats) opts.onStats({ fps: live() ? fps : 0, width: canvas.width, height: canvas.height, scale: scale, steps: STEPS, live: live(), slow: tooSlow });
    }

    /* Too slow on this GPU? Render fewer pixels instead of fewer frames. */
    function measure(dtMs, now) {
      fpsFrames++;
      if (!fpsT0) fpsT0 = now;
      if (now - fpsT0 >= 500) {
        fps = fpsFrames * 1000 / (now - fpsT0);
        fpsFrames = 0;
        fpsT0 = now;
        emit();
      }
      if (dtMs > 1000) return;                       // the tab was in the background
      samples.push(dtMs);
      acc += dtMs;
      if (samples.length < 24 && !(acc >= 1200 && samples.length >= 3)) return;
      var avg = acc / samples.length;
      samples = [];
      acc = 0;
      if (avg > 24 && scale > MIN_SCALE) {
        scale = Math.max(MIN_SCALE, scale - (avg > 50 ? 0.3 : 0.15));
        fastWindows = 0;
        if (grew) mayGrow = false;
        resize();
      } else if (avg > 160 && !insisted) {
        tooSlow = true;                              // no usable GPU: a still image beats a slideshow
        emit();
      } else if (avg < 13 && scale < 1 && mayGrow) {
        if (++fastWindows >= 5) { scale = Math.min(1, scale + 0.15); fastWindows = 0; grew = true; resize(); }
      } else {
        fastWindows = 0;
      }
    }

    function tick(now) {
      raf = 0;
      if (destroyed || lost) return;
      var dtMs = last ? now - last : 16.7;
      last = now;
      var isLive = live();
      if (isLive) {
        var dt = Math.min(dtMs, 100) / 1000;
        time += dt * params.speed;
        if (!dragging) cam.yaw += dt * 0.16 * Math.min(params.speed, 1.5);
      }
      if (morph) {
        var k = (now - morph.t0) / morph.dur;
        weights = mixWeights(morph.from, morph.to, ease(k));
        if (k >= 1) { weights = morph.to; morph = null; }
      }
      draw();
      if (isLive) measure(dtMs, now);
      if (isLive || morph) schedule();
      else { last = 0; fpsT0 = 0; fpsFrames = 0; samples = []; acc = 0; emit(); }
    }

    function schedule() {
      if (!raf && !destroyed && !lost && gl) raf = requestAnimationFrame(tick);
    }

    function resize() {
      if (destroyed || !gl) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      var oldW = canvas.width, oldH = canvas.height;
      var dpr = Math.min(root.devicePixelRatio || 1, maxDpr) * scale;
      var bw = Math.max(2, Math.round(w * dpr)), bh = Math.max(2, Math.round(h * dpr));
      var changed = bw !== oldW || bh !== oldH;
      if (changed) { canvas.width = bw; canvas.height = bh; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (changed && colors) draw();
      schedule();
      emit();
    }

    function set(next) {
      if (!next) return;
      var hadShape = next.shape != null;
      params = clampParams(Object.assign({}, params, next));
      if (hadShape) { morph = null; weights = shapeWeights(params.shape); }
      schedule();
    }

    /* Blend from whatever is on screen now to one named shape. */
    function morphTo(index, ms) {
      var i = clamp(Math.round(index), 0, SHAPES.length - 1);
      var target = shapeWeights(i);
      params.shape = i;
      if (!motionOK || !ms) { morph = null; weights = target; }
      else morph = { from: weights.slice(), to: target, t0: performance.now(), dur: ms };
      schedule();
    }

    /* force = true: an explicit press by the viewer may start motion even under prefers-reduced-motion. */
    function setRunning(flag, force) {
      running = !!flag;
      if (running && force) { motionOK = true; tooSlow = false; insisted = true; }
      if (!running && force) motionOK = !W.reducedMotion();
      schedule();
    }

    function setView(yaw, pitch) {
      if (yaw != null) cam.yaw = yaw;
      if (pitch != null) cam.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
      schedule();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* already gone */ } });
      cleanups = [];
      if (gl) {
        try {
          if (prog) gl.deleteProgram(prog);
          if (vbuf) gl.deleteBuffer(vbuf);
          var ext = gl.getExtension("WEBGL_lose_context");
          if (ext) ext.loseContext();
        } catch (e) { /* context already lost */ }
      }
      gl = null;
    }

    var inst = {
      ok: false,
      set: set,
      morphTo: morphTo,
      setRunning: setRunning,
      setView: setView,
      resize: resize,
      drawNow: draw,
      state: function () {
        return { params: Object.assign({}, params), weights: weights.slice(), scale: scale, running: running, live: live(), slow: tooSlow, width: canvas.width, height: canvas.height };
      },
      destroy: destroy
    };

    if (!setup()) { gl = null; return inst; }
    inst.ok = true;
    readColors();

    on(canvas, "webglcontextlost", function (e) {
      e.preventDefault();
      lost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    });
    on(canvas, "webglcontextrestored", function () {
      lost = false;
      if (setup()) { last = 0; resize(); schedule(); }
    });

    cleanups.push(W.onTheme(function () { readColors(); schedule(); }));
    cleanups.push(W.visible(canvas, function (v) { visible = v; last = 0; schedule(); }));
    if (root.ResizeObserver) {
      var ro = new ResizeObserver(resize);
      ro.observe(canvas);
      cleanups.push(function () { ro.disconnect(); });
    } else {
      on(root, "resize", resize);
    }

    if (interactive) {
      var px = 0, py = 0, pid = null;
      canvas.style.touchAction = "pan-y";
      canvas.style.cursor = "grab";
      on(canvas, "pointerdown", function (e) {
        if (e.button != null && e.button !== 0) return;
        pid = e.pointerId; px = e.clientX; py = e.clientY; dragging = true;
        try { canvas.setPointerCapture(pid); } catch (err) { /* pointer already released */ }
        canvas.style.cursor = "grabbing";
      });
      on(canvas, "pointermove", function (e) {
        if (!dragging || e.pointerId !== pid) return;
        cam.yaw -= (e.clientX - px) * 0.008;
        cam.pitch = clamp(cam.pitch + (e.clientY - py) * 0.006, PITCH_MIN, PITCH_MAX);
        px = e.clientX; py = e.clientY;
        schedule();
      });
      var release = function (e) {
        if (e.pointerId !== pid) return;
        dragging = false; pid = null;
        canvas.style.cursor = "grab";
      };
      on(canvas, "pointerup", release);
      on(canvas, "pointercancel", release);
      on(canvas, "keydown", function (e) {
        var step = 0.12, used = true;
        if (e.key === "ArrowLeft") cam.yaw += step;
        else if (e.key === "ArrowRight") cam.yaw -= step;
        else if (e.key === "ArrowUp") cam.pitch = clamp(cam.pitch + step, PITCH_MIN, PITCH_MAX);
        else if (e.key === "ArrowDown") cam.pitch = clamp(cam.pitch - step, PITCH_MIN, PITCH_MAX);
        else used = false;
        if (used) { e.preventDefault(); schedule(); }
      });
    }

    resize();
    schedule();
    return inst;
  }

  /* ---------- the demo ---------- */
  function mount(rootEl) {
    var el = W.el;
    var reduced = W.reducedMotion();
    var playing = !reduced;
    var slow = false;
    var shapeIdx = 1;
    var start = { unrest: 0.45, speed: 1, gloss: 0.6 };

    var canvas = el("canvas", {
      class: "d-shader-canvas", tabindex: "0", role: "img",
      "aria-label": "Lichtgestalt: ein live berechneter Körper. Ziehen oder Pfeiltasten drehen die Kamera."
    });
    var hint = el("span", { class: "chip d-shader-hint", text: "Ziehen dreht die Kamera" });
    var view = el("div", { class: "demo-canvas d-shader-view" }, canvas, hint);
    var code = el("details", { class: "d-shader-code" },
      el("summary", null, "Shader-Code zeigen"),
      el("pre", { class: "code", tabindex: "0", "aria-label": "GLSL-Quelltext des Fragment-Shaders", text: FRAG.trim() }));
    var main = el("div", { class: "d-shader-main" }, view, code);

    var shapeBtns = SHAPES.map(function (name, i) {
      return el("button", {
        type: "button", "aria-pressed": i === shapeIdx ? "true" : "false", text: name,
        onclick: function () { pickShape(i); }
      });
    });
    var seg = el("div", { class: "seg", role: "group", "aria-label": "Gestalt" }, shapeBtns);

    function slider(id, label, key, max) {
      var value = Math.round(start[key] * 100);
      var out = el("output", { "for": id, text: value + " %" });
      var input = el("input", { type: "range", id: id, min: "0", max: String(max), step: "1", value: String(value) });
      input.addEventListener("input", function () {
        out.textContent = input.value + " %";
        var patch = {};
        patch[key] = input.value / 100;
        inst.set(patch);
      });
      return {
        input: input,
        out: out,
        node: el("label", { class: "field", "for": id }, el("span", { class: "field-row" }, el("span", null, label), out), input)
      };
    }
    var sUnrest = slider("d-shader-unruhe", "Unruhe", "unrest", 100);
    var sSpeed = slider("d-shader-tempo", "Tempo", "speed", 200);
    var sGloss = slider("d-shader-glanz", "Glanz", "gloss", 100);

    var playBtn = el("button", { type: "button", class: "btn btn--primary btn--sm", onclick: togglePlay });
    var randomBtn = el("button", { type: "button", class: "btn btn--sm", text: "Zufall", onclick: randomize });
    var ddFps = el("dd", { text: "–" });
    var ddRes = el("dd", { text: "–" });
    var ddSteps = el("dd", { text: "bis zu " + STEPS });
    var stats = el("dl", { class: "kv" },
      el("dt", null, "Bilder pro Sekunde"), ddFps,
      el("dt", null, "Renderauflösung"), ddRes,
      el("dt", null, "Schritte pro Strahl"), ddSteps);
    var note = el("p", { class: "note" });

    var side = el("div", { class: "demo-side" },
      el("div", { class: "d-shader-group" }, el("p", { class: "demo-h", text: "Gestalt" }), seg),
      sUnrest.node, sSpeed.node, sGloss.node,
      el("div", { class: "demo-bar" }, playBtn, randomBtn),
      stats, note);

    rootEl.appendChild(el("div", { class: "demo-grid d-shader" }, main, side));

    var inst = create(canvas, {
      interactive: true,
      autoplay: playing,
      params: { shape: shapeIdx, unrest: start.unrest, speed: start.speed, gloss: start.gloss },
      onStats: function (s) {
        if (s.slow && playing) { playing = false; slow = true; renderPlay(); }
        ddFps.textContent = s.live ? W.fmt(s.fps) : (s.slow ? "Standbild" : "pausiert");
        ddRes.textContent = W.fmt(s.width) + " × " + W.fmt(s.height);
        renderNote(s.scale);
      }
    });

    function renderNote(scale) {
      var parts = [];
      if (slow && !playing) parts.push("Dieses Gerät rechnet gerade ohne Grafikkarte. Ich zeige deshalb ein Standbild; „Weiter“ startet die Bewegung trotzdem.");
      else if (reduced && !playing) parts.push("Dein System wünscht wenig Bewegung, deshalb steht die Gestalt still, bis du „Abspielen“ drückst.");
      else if (scale < 0.99) parts.push("Auflösung auf " + Math.round(scale * 100) + " % gesenkt, damit es flüssig bleibt.");
      if (!parts.length) parts.push("Pfeiltasten drehen die Kamera, wenn das Bild den Fokus hat.");
      note.textContent = parts.join(" ");
    }

    function renderPlay() {
      playBtn.textContent = playing ? "Pause" : (reduced && !slow ? "Abspielen" : "Weiter");
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }

    function togglePlay() {
      playing = !playing;
      inst.setRunning(playing, true);
      renderPlay();
      renderNote(inst.state().scale);
    }

    function pickShape(i) {
      shapeIdx = i;
      shapeBtns.forEach(function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
      inst.morphTo(i, 900);
    }

    function randomize() {
      var next = shapeIdx;
      while (next === shapeIdx) next = Math.floor(Math.random() * SHAPES.length);
      var values = { unrest: 0.15 + Math.random() * 0.8, speed: 0.5 + Math.random(), gloss: 0.2 + Math.random() * 0.8 };
      [[sUnrest, "unrest"], [sSpeed, "speed"], [sGloss, "gloss"]].forEach(function (pair) {
        var v = Math.round(values[pair[1]] * 100);
        pair[0].input.value = String(v);
        pair[0].out.textContent = v + " %";
        values[pair[1]] = v / 100;
      });
      inst.set(values);
      pickShape(next);
    }

    renderPlay();
    renderNote(1);

    if (!inst.ok) {
      view.textContent = "";
      view.appendChild(el("div", { class: "d-shader-fallback" },
        el("p", { class: "d-shader-fallback-title", text: "Hier fehlt WebGL." }),
        el("p", { text: "Die Lichtgestalt wird live auf der Grafikkarte berechnet. Dieser Browser stellt dafür gerade kein WebGL bereit, deshalb bleibt die Fläche leer. Der Shader-Code darunter ist trotzdem der echte." })));
      shapeBtns.concat([sUnrest.input, sSpeed.input, sGloss.input, playBtn, randomBtn]).forEach(function (c) { c.disabled = true; });
      ddFps.textContent = "–";
      note.textContent = "Ohne WebGL sind die Regler abgeschaltet.";
    }

    return {
      view: inst,
      destroy: function () {
        inst.destroy();
        rootEl.textContent = "";
      }
    };
  }

  W.shader = {
    create: create,
    SHAPES: SHAPES,
    STEPS: STEPS,
    DEFAULTS: DEFAULTS,
    FRAG: FRAG,
    clampParams: clampParams,
    shapeWeights: shapeWeights,
    mixWeights: mixWeights,
    ease: ease,
    hexToRgb: hexToRgb,
    toLinear: toLinear,
    orbit: orbit
  };

  W.register("shader", {
    title: "Lichtgestalt",
    kind: "Grafik · Mathematik",
    lead: "Diesen Körper habe ich nicht modelliert, sondern ausgerechnet: Mein Shader bestimmt für jedes Pixel neu, wo die Oberfläche liegt. Zieh ihn herum, wechsle die Gestalt und dreh an der Unruhe.",
    facts: [
      "WebGL 1, ohne Bibliotheken",
      "ein Fragment-Shader, " + FRAG.trim().split("\n").length + " Zeilen GLSL",
      "bis zu " + STEPS + " Schritte pro Strahl"
    ],
    moral: "Ein paar Zeilen Mathematik reichen für eine ganze Gestalt, wenn jede Zeile stimmt.",
    mount: mount
  });
})();
