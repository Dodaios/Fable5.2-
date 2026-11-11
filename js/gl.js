/* WebGL2-Hilfsschicht: Programme, Float-Texturen, Offscreen-Ziele.
 * Klassisches Skript (kein ES-Modul), damit die Seite auch per Doppelklick
 * (file://) funktioniert. */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});

  const VS_FULLSCREEN = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  class Program {
    constructor(glx, fs, vs, name) {
      const gl = glx.gl;
      this.glx = glx;
      this.name = name || 'program';
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(s);
          const numbered = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
          console.error('Shader "' + this.name + '":\n' + log + '\n' + numbered);
          throw new Error('Shader-Fehler in "' + this.name + '": ' + log);
        }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs || VS_FULLSCREEN));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('Link-Fehler in "' + this.name + '": ' + gl.getProgramInfoLog(p));
      }
      this.p = p;
      this.uniforms = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const nm = info.name.replace(/\[0\]$/, '');
        this.uniforms[nm] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
      }
      this.commonStamp = -1;
    }

    _set(u, v) {
      const gl = this.glx.gl;
      switch (u.type) {
        case gl.FLOAT:
          if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v);
          break;
        case gl.INT: case gl.BOOL:
          gl.uniform1i(u.loc, v); break;
        case gl.FLOAT_VEC2:
          if (u.size > 1) gl.uniform2fv(u.loc, v); else gl.uniform2f(u.loc, v[0], v[1]);
          break;
        case gl.FLOAT_VEC3:
          if (u.size > 1) gl.uniform3fv(u.loc, v); else gl.uniform3f(u.loc, v[0], v[1], v[2]);
          break;
        case gl.FLOAT_VEC4:
          if (u.size > 1) gl.uniform4fv(u.loc, v); else gl.uniform4f(u.loc, v[0], v[1], v[2], v[3]);
          break;
        case gl.INT_VEC2: gl.uniform2i(u.loc, v[0], v[1]); break;
        case gl.INT_VEC4: gl.uniform4i(u.loc, v[0], v[1], v[2], v[3]); break;
        default: throw new Error('Uniform-Typ nicht unterstützt: ' + u.type);
      }
    }

    /** Programm aktivieren; `values` setzt Uniforms, Sampler bekommen automatisch Textureinheiten. */
    use(values) {
      const glx = this.glx, gl = glx.gl;
      gl.useProgram(this.p);
      if (this.commonStamp !== glx.commonStamp) {
        for (const k in glx.common) {
          const u = this.uniforms[k];
          if (u) this._set(u, glx.common[k]);
        }
        this.commonStamp = glx.commonStamp;
      }
      let unit = 0;
      for (const k in values) {
        const u = this.uniforms[k];
        if (!u) continue;
        const v = values[k];
        if (u.type === gl.SAMPLER_2D) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v.tex || v);
          gl.uniform1i(u.loc, unit);
          unit++;
        } else {
          this._set(u, v);
        }
      }
      return this;
    }
  }

  class GLX {
    constructor(canvas, attrs) {
      const gl = canvas.getContext('webgl2', Object.assign({
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }, attrs || {}));
      if (!gl) throw new Error('WebGL2 wird von diesem Browser/Gerät nicht unterstützt.');
      this.gl = gl;
      this.canvas = canvas;
      this.floatExt = gl.getExtension('EXT_color_buffer_float');
      this.halfExt = gl.getExtension('EXT_color_buffer_half_float');
      this.precision = this.floatExt ? 32 : 16;
      if (!this.floatExt && !this.halfExt) {
        throw new Error('Dieses Gerät kann nicht in Gleitkomma-Texturen rendern (EXT_color_buffer_float fehlt).');
      }
      this.common = {};
      this.commonStamp = 0;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      this.drawCalls = 0;
    }

    setCommon(obj) {
      Object.assign(this.common, obj);
      this.commonStamp++;
    }

    program(fs, name, vs) { return new Program(this, fs, vs, name); }

    _formats(kind) {
      const gl = this.gl;
      const f32 = this.precision === 32;
      switch (kind) {
        case 'r': return [f32 ? gl.R32F : gl.R16F, gl.RED, f32 ? gl.FLOAT : gl.HALF_FLOAT];
        case 'rg': return [f32 ? gl.RG32F : gl.RG16F, gl.RG, f32 ? gl.FLOAT : gl.HALF_FLOAT];
        case 'rgba': return [f32 ? gl.RGBA32F : gl.RGBA16F, gl.RGBA, f32 ? gl.FLOAT : gl.HALF_FLOAT];
        case 'r8': return [gl.R8, gl.RED, gl.UNSIGNED_BYTE];
        default: throw new Error('Unbekanntes Texturformat ' + kind);
      }
    }

    /** Offscreen-Ziel (Textur + Framebuffer). */
    target(w, h, kind, filter) {
      const gl = this.gl;
      const [ifmt, fmt, type] = this._formats(kind);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      const f = filter || gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer unvollständig (' + kind + ', ' + st + ')');
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h, kind };
    }

    /** Datentextur (nur lesbar), Float32, ein Kanal. */
    dataTexture(w, h, data) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, w, h };
    }

    /** Float32-Daten in ein Ziel hochladen (Tests / Anfangsdaten). */
    upload(target, data) {
      const gl = this.gl;
      const fmt = this._formats(target.kind)[1];
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, target.w, target.h, fmt, gl.FLOAT, data);
    }

    free(t) {
      if (!t) return;
      const gl = this.gl;
      if (t.fbo) gl.deleteFramebuffer(t.fbo);
      if (t.tex) gl.deleteTexture(t.tex);
    }

    /** Vollbild-Dreieck in ein Ziel zeichnen (null = Canvas). */
    draw(target) {
      const gl = this.gl;
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.drawCalls++;
    }

    clear(target, r, g, b, a) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.clearColor(r || 0, g || 0, b || 0, a || 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    /** Synchrones Auslesen (nur für Tests/Export – blockiert die GPU-Pipeline). */
    read(target, x, y, w, h) {
      const gl = this.gl;
      x = x || 0; y = y || 0; w = w || target.w; h = h || target.h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      if (target.kind === 'r8') {
        const b = new Uint8Array(w * h * 4);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
        return b;
      }
      const out = new Float32Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
      return out;
    }
  }

  NS.GLX = GLX;
  NS.VS_FULLSCREEN = VS_FULLSCREEN;
})();
