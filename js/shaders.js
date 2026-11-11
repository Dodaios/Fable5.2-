/* GLSL sources of the Navier-Stokes solver.
 *
 * Grid: staggered MAC grid (Harlow & Welch), square cells, dx = 1.
 *   u(i,j) lives on the left cell face    (x = i,     y = j+1/2)
 *   v(i,j) lives on the bottom cell face  (x = i+1/2, y = j)
 *   p, dye, temperature, mask: cell centre (i+1/2, j+1/2)
 * The velocity texture has (Nx+1) x (Ny+1) texels so that the boundary
 * faces at i = Nx and j = Ny are stored as well.
 */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});

  const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

  // ---------------------------------------------------------------------------
  // Boundary conditions and field accessors (ghost cells are generated here)
  // Boundary types: 0 no-slip wall, 1 slip wall, 2 periodic, 3 inflow (left only), 4 outflow (right only)
  // ---------------------------------------------------------------------------
  const COMMON = `
uniform ivec2 uN;        // cells (Nx, Ny)
uniform ivec4 uBC;       // left, right, bottom, top
uniform vec2 uWallU;     // tangential velocity of the bottom / top wall
uniform vec4 uInflow;    // x: profile (0 uniform, 1 parabola, 2 jet), y: amplitude, z: centre, w: half-width
uniform vec4 uTempBC;    // bottom (mode, T), top (mode, T); mode 1 = fixed temperature
uniform vec4 uInDye;     // x: number of stripes at the inflow (0 = none), y: duty cycle, z: inflow temperature, w: 1 = dye follows the inflow profile
uniform vec3 uInColA;
uniform vec3 uInColB;

float inflowU(float y) {
  float s = y / float(uN.y);
  if (uInflow.x < 0.5) return uInflow.y;
  if (uInflow.x < 1.5) return 6.0 * uInflow.y * s * (1.0 - s);
  float d = (uInflow.w - abs(s - uInflow.z)) * float(uN.y);
  return uInflow.y * 0.5 * (1.0 + tanh(d / 1.5));
}

vec4 inflowS(float y) {
  vec4 r = vec4(0.0, 0.0, 0.0, uInDye.z);
  if (uInDye.w > 0.5) {
    r.rgb = uInColA * clamp(inflowU(y) / max(abs(uInflow.y), 1e-6), 0.0, 1.0);
  } else if (uInDye.x > 0.5) {
    float s = y / float(uN.y) * uInDye.x;
    float k = floor(s);
    float e = 0.75 * uInDye.x / float(uN.y);
    float on = 1.0 - smoothstep(0.5 * uInDye.y - e, 0.5 * uInDye.y + e, abs(fract(s) - 0.5));
    r.rgb = on * (mod(k, 2.0) < 0.5 ? uInColA : uInColB);
  }
  return r;
}

// u on face (i, j+1/2); valid for i in [0,Nx], j in [0,Ny-1]
float fetchU(sampler2D t, ivec2 c) {
  float s = 1.0, a = 0.0;
  if (c.y < 0) {
    if (uBC.z == 2) c.y += uN.y;
    else { c.y = -1 - c.y; if (uBC.z == 0) { s = -1.0; a = 2.0 * uWallU.x; } }
  } else if (c.y >= uN.y) {
    if (uBC.w == 2) c.y -= uN.y;
    else { c.y = 2 * uN.y - 1 - c.y; if (uBC.w == 0) { s = -1.0; a = 2.0 * uWallU.y; } }
  }
  if (uBC.x == 2) {
    if (c.x < 0) c.x += uN.x; else if (c.x >= uN.x) c.x -= uN.x;
    return s * texelFetch(t, c, 0).x + a;
  }
  if (c.x < 0) {
    float ub = texelFetch(t, ivec2(0, c.y), 0).x;
    return s * (2.0 * ub - texelFetch(t, ivec2(-c.x, c.y), 0).x) + a;
  }
  if (c.x > uN.x) {
    float ub = texelFetch(t, ivec2(uN.x, c.y), 0).x;
    if (uBC.y == 4) return s * ub + a;
    return s * (2.0 * ub - texelFetch(t, ivec2(2 * uN.x - c.x, c.y), 0).x) + a;
  }
  return s * texelFetch(t, c, 0).x + a;
}

// v on face (i+1/2, j); valid for i in [0,Nx-1], j in [0,Ny]
float fetchV(sampler2D t, ivec2 c) {
  float s = 1.0;
  if (c.x < 0) {
    if (uBC.x == 2) c.x += uN.x;
    else { c.x = -1 - c.x; if (uBC.x == 0 || uBC.x == 3) s = -1.0; }
  } else if (c.x >= uN.x) {
    if (uBC.y == 2) c.x -= uN.x;
    else { c.x = 2 * uN.x - 1 - c.x; if (uBC.y == 0) s = -1.0; }
  }
  if (uBC.z == 2) {
    if (c.y < 0) c.y += uN.y; else if (c.y >= uN.y) c.y -= uN.y;
    return s * texelFetch(t, c, 0).y;
  }
  if (c.y < 0) {
    float vb = texelFetch(t, ivec2(c.x, 0), 0).y;
    return s * (2.0 * vb - texelFetch(t, ivec2(c.x, -c.y), 0).y);
  }
  if (c.y > uN.y) {
    float vb = texelFetch(t, ivec2(c.x, uN.y), 0).y;
    return s * (2.0 * vb - texelFetch(t, ivec2(c.x, 2 * uN.y - c.y), 0).y);
  }
  return s * texelFetch(t, c, 0).y;
}

// cell-centred quantity with Neumann boundary (mirroring) or periodic: pressure, mask
float fetchC(sampler2D t, ivec2 c) {
  if (uBC.x == 2) { if (c.x < 0) c.x += uN.x; else if (c.x >= uN.x) c.x -= uN.x; }
  else c.x = clamp(c.x, 0, uN.x - 1);
  if (uBC.z == 2) { if (c.y < 0) c.y += uN.y; else if (c.y >= uN.y) c.y -= uN.y; }
  else c.y = clamp(c.y, 0, uN.y - 1);
  return texelFetch(t, c, 0).x;
}

// scalars (rgb = dye, a = temperature)
vec4 fetchS(sampler2D t, ivec2 c) {
  vec4 s = vec4(1.0), a = vec4(0.0);
  if (c.y < 0) {
    if (uBC.z == 2) c.y += uN.y;
    else { c.y = -1 - c.y; if (uTempBC.x > 0.5) { s.a = -1.0; a.a = 2.0 * uTempBC.y; } }
  } else if (c.y >= uN.y) {
    if (uBC.w == 2) c.y -= uN.y;
    else { c.y = 2 * uN.y - 1 - c.y; if (uTempBC.z > 0.5) { s.a = -1.0; a.a = 2.0 * uTempBC.w; } }
  }
  if (c.x < 0) {
    if (uBC.x == 2) c.x += uN.x;
    else {
      c.x = -1 - c.x;
      if (uBC.x == 3) return s * (2.0 * inflowS(float(c.y) + 0.5) - texelFetch(t, c, 0)) + a;
    }
  } else if (c.x >= uN.x) {
    if (uBC.y == 2) c.x -= uN.x; else c.x = 2 * uN.x - 1 - c.x;
  }
  return s * texelFetch(t, c, 0) + a;
}
`;

  // ---------------------------------------------------------------------------
  // Tool (cursor): soft coupling (Brinkman-like) or rigid rod
  // ---------------------------------------------------------------------------
  const TOOL = `
uniform vec4 uToolSeg;   // x0, y0, x1, y1 in grid units (path segment of this substep)
uniform vec4 uToolPar;   // radius, coupling rate, hard (0/1), active (0/1)
float toolDist(vec2 p) {
  vec2 ab = uToolSeg.zw - uToolSeg.xy;
  vec2 d = p - uToolSeg.xy;
  float t = clamp(dot(d, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  return length(d - t * ab);
}
float toolW(vec2 p, float dtEff) {
  if (uToolPar.w < 0.5) return 0.0;
  float d = toolDist(p);
  if (uToolPar.z > 0.5) return clamp(uToolPar.x + 0.5 - d, 0.0, 1.0);
  float g = d / uToolPar.x;
  return 1.0 - exp(-uToolPar.y * dtEff * exp(-g * g));
}
`;

  // ---------------------------------------------------------------------------
  // Right-hand side of the momentum equation (without the constraint)
  //   N(u) = -div(u u) + nu * Laplace(u) - grad(p) + f
  // Advection in divergence form; central averaging (energy conserving) with
  // optional QUICK upwind correction (gamma in [0,1]).
  // ---------------------------------------------------------------------------
  const RHS_FUNCS = `
uniform sampler2D uVel;
uniform sampler2D uPres;
uniform sampler2D uScal;
uniform float uNu;
uniform vec2 uUpw;       // gamma = clamp(uUpw.x + uUpw.y * |a|, 0, 1)
uniform vec2 uForce;     // uniform body force
uniform vec2 uBuoy;      // buoyancy coefficient, reference temperature

float faceVal(float a, float qmm, float qm, float qp, float qpp) {
  float g = clamp(uUpw.x + uUpw.y * abs(a), 0.0, 1.0);
  float curv = a >= 0.0 ? (qp - 2.0 * qm + qmm) : (qm - 2.0 * qp + qpp);
  return 0.5 * (qm + qp) - 0.125 * g * curv;
}

float tendU(ivec2 c) {
  float uC = fetchU(uVel, c);
  float uE = fetchU(uVel, c + ivec2(1, 0)), uW = fetchU(uVel, c + ivec2(-1, 0));
  float uEE = fetchU(uVel, c + ivec2(2, 0)), uWW = fetchU(uVel, c + ivec2(-2, 0));
  float uT = fetchU(uVel, c + ivec2(0, 1)), uB = fetchU(uVel, c + ivec2(0, -1));
  float uTT = fetchU(uVel, c + ivec2(0, 2)), uBB = fetchU(uVel, c + ivec2(0, -2));
  float aE = 0.5 * (uC + uE), aW = 0.5 * (uW + uC);
  float aT = 0.5 * (fetchV(uVel, c + ivec2(-1, 1)) + fetchV(uVel, c + ivec2(0, 1)));
  float aB = 0.5 * (fetchV(uVel, c + ivec2(-1, 0)) + fetchV(uVel, c));
  float adv = -(aE * faceVal(aE, uW, uC, uE, uEE) - aW * faceVal(aW, uWW, uW, uC, uE))
              -(aT * faceVal(aT, uB, uC, uT, uTT) - aB * faceVal(aB, uBB, uB, uC, uT));
  float visc = uNu * (uE + uW + uT + uB - 4.0 * uC);
  float pres = -(fetchC(uPres, c) - fetchC(uPres, c + ivec2(-1, 0)));
  return adv + visc + pres + uForce.x;
}

float tendV(ivec2 c) {
  float vC = fetchV(uVel, c);
  float vE = fetchV(uVel, c + ivec2(1, 0)), vW = fetchV(uVel, c + ivec2(-1, 0));
  float vEE = fetchV(uVel, c + ivec2(2, 0)), vWW = fetchV(uVel, c + ivec2(-2, 0));
  float vT = fetchV(uVel, c + ivec2(0, 1)), vB = fetchV(uVel, c + ivec2(0, -1));
  float vTT = fetchV(uVel, c + ivec2(0, 2)), vBB = fetchV(uVel, c + ivec2(0, -2));
  float aE = 0.5 * (fetchU(uVel, c + ivec2(1, -1)) + fetchU(uVel, c + ivec2(1, 0)));
  float aW = 0.5 * (fetchU(uVel, c + ivec2(0, -1)) + fetchU(uVel, c));
  float aT = 0.5 * (vC + vT), aB = 0.5 * (vB + vC);
  float adv = -(aE * faceVal(aE, vW, vC, vE, vEE) - aW * faceVal(aW, vWW, vW, vC, vE))
              -(aT * faceVal(aT, vB, vC, vT, vTT) - aB * faceVal(aB, vBB, vB, vC, vT));
  float visc = uNu * (vE + vW + vT + vB - 4.0 * vC);
  float pres = -(fetchC(uPres, c) - fetchC(uPres, c + ivec2(0, -1)));
  float buoy = 0.0;
  if (uBuoy.x != 0.0) {
    buoy = uBuoy.x * (0.5 * (fetchS(uScal, c).a + fetchS(uScal, c + ivec2(0, -1)).a) - uBuoy.y);
  }
  return adv + visc + pres + uForce.y + buoy;
}
`;

  // ---------------------------------------------------------------------------
  // Runge-Kutta stage for the velocity (uMode 0) or tendency only (uMode 1)
  //   u~ = a * u^n + b * (v + dt * N(v)), followed by solid-body and tool forcing
  // ---------------------------------------------------------------------------
  const RHS = HEAD + COMMON + TOOL + RHS_FUNCS + `
uniform sampler2D uVel0;
uniform sampler2D uMask;
uniform float uDt;
uniform vec2 uAB;
uniform float uUc;       // convection velocity of the outflow condition
uniform int uMode;
uniform vec2 uToolVel;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  bool perX = uBC.x == 2, perY = uBC.z == 2;
  vec2 res = vec2(0.0);

  ivec2 cu = c;
  if (perX && cu.x == uN.x) cu.x = 0;
  if (cu.y < uN.y) {
    float uc = texelFetch(uVel, cu, 0).x;
    bool inner = perX || (cu.x > 0 && cu.x < uN.x);
    float t;
    if (inner) t = tendU(cu);
    else if (cu.x == 0) t = ((uBC.x == 3 ? inflowU(float(cu.y) + 0.5) : 0.0) - uc) / uDt;
    else t = (uBC.y == 4) ? -uUc * (uc - texelFetch(uVel, cu - ivec2(1, 0), 0).x) : -uc / uDt;
    if (uMode == 1) res.x = t;
    else {
      float un = uAB.x * texelFetch(uVel0, cu, 0).x + uAB.y * (uc + uDt * t);
      if (inner) {
        un *= 1.0 - 0.5 * (fetchC(uMask, cu) + fetchC(uMask, cu - ivec2(1, 0)));
        un = mix(un, uToolVel.x, toolW(vec2(cu) + vec2(0.0, 0.5), uAB.y * uDt));
      }
      res.x = un;
    }
  }

  ivec2 cv = c;
  if (perY && cv.y == uN.y) cv.y = 0;
  if (cv.x < uN.x) {
    float vc = texelFetch(uVel, cv, 0).y;
    bool inner = perY || (cv.y > 0 && cv.y < uN.y);
    float t = inner ? tendV(cv) : -vc / uDt;
    if (uMode == 1) res.y = t;
    else {
      float vn = uAB.x * texelFetch(uVel0, cv, 0).y + uAB.y * (vc + uDt * t);
      if (inner) {
        vn *= 1.0 - 0.5 * (fetchC(uMask, cv) + fetchC(uMask, cv - ivec2(0, 1)));
        vn = mix(vn, uToolVel.y, toolW(vec2(cv) + vec2(0.5, 0.0), uAB.y * uDt));
      }
      res.y = vn;
    }
  }
  o = vec4(res, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // 2nd-order Runge-Kutta-Chebyshev stage for stiff viscosity (F(Y) = nu*Laplace(Y) + S):
  //   Y_j = c0*Y_0 + c1*Y_{j-1} + c2*Y_{j-2} + c3*dt*F(Y_{j-1}) + c4*dt*F(Y_0)
  // ---------------------------------------------------------------------------
  const RKC = HEAD + COMMON + TOOL + `
uniform sampler2D uY0;
uniform sampler2D uY1;
uniform sampler2D uY2;
uniform sampler2D uS;
uniform sampler2D uMask;
uniform float uC0;
uniform vec4 uC;         // c1, c2, c3*dt, c4*dt
uniform float uNu;
uniform float uDtEff;
uniform vec2 uToolVel;
out vec4 o;
float lapU(sampler2D t, ivec2 c, float yc) {
  return fetchU(t, c + ivec2(1, 0)) + fetchU(t, c + ivec2(-1, 0)) + fetchU(t, c + ivec2(0, 1)) + fetchU(t, c + ivec2(0, -1)) - 4.0 * yc;
}
float lapV(sampler2D t, ivec2 c, float yc) {
  return fetchV(t, c + ivec2(1, 0)) + fetchV(t, c + ivec2(-1, 0)) + fetchV(t, c + ivec2(0, 1)) + fetchV(t, c + ivec2(0, -1)) - 4.0 * yc;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  bool perX = uBC.x == 2, perY = uBC.z == 2;
  vec2 res = vec2(0.0);

  ivec2 cu = c;
  if (perX && cu.x == uN.x) cu.x = 0;
  if (cu.y < uN.y) {
    float y0 = texelFetch(uY0, cu, 0).x, y1 = texelFetch(uY1, cu, 0).x;
    bool inner = perX || (cu.x > 0 && cu.x < uN.x);
    float S = texelFetch(uS, cu, 0).x;
    float F1 = S, F0 = S;
    if (inner) {
      if (uC.z != 0.0) F1 += uNu * lapU(uY1, cu, y1);
      if (uC.w != 0.0) F0 += uNu * lapU(uY0, cu, y0);
    }
    float un = uC0 * y0 + uC.x * y1 + uC.y * texelFetch(uY2, cu, 0).x + uC.z * F1 + uC.w * F0;
    if (inner) {
      un *= 1.0 - 0.5 * (fetchC(uMask, cu) + fetchC(uMask, cu - ivec2(1, 0)));
      un = mix(un, uToolVel.x, toolW(vec2(cu) + vec2(0.0, 0.5), uDtEff));
    }
    res.x = un;
  }

  ivec2 cv = c;
  if (perY && cv.y == uN.y) cv.y = 0;
  if (cv.x < uN.x) {
    float y0 = texelFetch(uY0, cv, 0).y, y1 = texelFetch(uY1, cv, 0).y;
    bool inner = perY || (cv.y > 0 && cv.y < uN.y);
    float S = texelFetch(uS, cv, 0).y;
    float F1 = S, F0 = S;
    if (inner) {
      if (uC.z != 0.0) F1 += uNu * lapV(uY1, cv, y1);
      if (uC.w != 0.0) F0 += uNu * lapV(uY0, cv, y0);
    }
    float vn = uC0 * y0 + uC.x * y1 + uC.y * texelFetch(uY2, cv, 0).y + uC.z * F1 + uC.w * F0;
    if (inner) {
      vn *= 1.0 - 0.5 * (fetchC(uMask, cv) + fetchC(uMask, cv - ivec2(0, 1)));
      vn = mix(vn, uToolVel.y, toolW(vec2(cv) + vec2(0.5, 0.0), uDtEff));
    }
    res.y = vn;
  }
  o = vec4(res, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // Scalar transport (dye rgb, temperature a): conservative flux form,
  // 3rd-order upwind scheme with Koren limiter (TVD, shape preserving)
  // ---------------------------------------------------------------------------
  const SCALAR = HEAD + COMMON + TOOL + `
uniform sampler2D uVel;
uniform sampler2D uScal;
uniform sampler2D uScal0;
uniform float uDt;
uniform vec2 uAB;
uniform vec4 uDiff;       // diffusivities per channel
uniform vec4 uToolCol;    // target value of the tool
uniform vec4 uToolChan;   // affected channels (0/1)
out vec4 o;

vec4 lim(vec4 a, vec4 b) {
  vec4 s = sign(a);
  vec4 aa = abs(a), bb = b * s;
  return s * max(min(min(2.0 * bb, (aa + 2.0 * bb) / 3.0), 2.0 * aa), 0.0);
}
vec4 flux(float vel, vec4 qmm, vec4 qm, vec4 qp, vec4 qpp) {
  return vel >= 0.0 ? vel * (qm + 0.5 * lim(qm - qmm, qp - qm))
                    : vel * (qp + 0.5 * lim(qp - qpp, qm - qp));
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 qC = texelFetch(uScal, c, 0);
  vec4 qE = fetchS(uScal, c + ivec2(1, 0)), qW = fetchS(uScal, c + ivec2(-1, 0));
  vec4 qEE = fetchS(uScal, c + ivec2(2, 0)), qWW = fetchS(uScal, c + ivec2(-2, 0));
  vec4 qT = fetchS(uScal, c + ivec2(0, 1)), qB = fetchS(uScal, c + ivec2(0, -1));
  vec4 qTT = fetchS(uScal, c + ivec2(0, 2)), qBB = fetchS(uScal, c + ivec2(0, -2));
  float uW = texelFetch(uVel, c, 0).x, uE = fetchU(uVel, c + ivec2(1, 0));
  float vB = texelFetch(uVel, c, 0).y, vT = fetchV(uVel, c + ivec2(0, 1));
  vec4 tend = -(flux(uE, qW, qC, qE, qEE) - flux(uW, qWW, qW, qC, qE))
              -(flux(vT, qB, qC, qT, qTT) - flux(vB, qBB, qB, qC, qT))
              + uDiff * (qE + qW + qT + qB - 4.0 * qC);
  vec4 q0 = texelFetch(uScal0, c, 0);
  vec4 qn = uAB.x * q0 + uAB.y * (qC + uDt * tend);
  // Safety net: local maximum principle. With the CFL condition met and a divergence-free
  // field the scheme satisfies it by itself; the clamp only acts on outliers.
  vec4 lo = min(min(min(qC, q0), min(qE, qW)), min(qT, qB));
  vec4 hi = max(max(max(qC, q0), max(qE, qW)), max(qT, qB));
  qn = clamp(qn, lo, hi);
  float w = toolW(vec2(c) + 0.5, uAB.y * uDt);
  o = mix(qn, uToolCol, w * uToolChan);
}
`;

  // ---------------------------------------------------------------------------
  // Projection: divergence, mass-flux correction at the outflow, gradient subtraction
  // ---------------------------------------------------------------------------
  const OUTFLOW = HEAD + COMMON + `
uniform sampler2D uVel;
out vec4 o;
void main() {
  float qin = 0.0, qout = 0.0;
  for (int j = 0; j < uN.y; j++) {
    qin += texelFetch(uVel, ivec2(0, j), 0).x;
    qout += texelFetch(uVel, ivec2(uN.x, j), 0).x;
  }
  o = vec4((qin - qout) / float(uN.y), qin, qout, 1.0);
}
`;

  const DIV = HEAD + COMMON + `
uniform sampler2D uVel;
uniform sampler2D uCorr;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 w = texelFetch(uVel, c, 0).xy;
  float uR = fetchU(uVel, c + ivec2(1, 0));
  float vT = fetchV(uVel, c + ivec2(0, 1));
  if (uBC.y == 4 && c.x == uN.x - 1) uR += texelFetch(uCorr, ivec2(0), 0).x;
  o = vec4(uR - w.x + vT - w.y, 0.0, 0.0, 1.0);
}
`;

  const GRADSUB = HEAD + COMMON + `
uniform sampler2D uVel;
uniform sampler2D uPsi;
uniform sampler2D uCorr;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  bool perX = uBC.x == 2, perY = uBC.z == 2;
  vec2 res = vec2(0.0);
  ivec2 cu = c;
  if (perX && cu.x == uN.x) cu.x = 0;
  if (cu.y < uN.y) {
    float u = texelFetch(uVel, cu, 0).x;
    if (perX || (cu.x > 0 && cu.x < uN.x)) u -= fetchC(uPsi, cu) - fetchC(uPsi, cu - ivec2(1, 0));
    else if (cu.x == uN.x && uBC.y == 4) u += texelFetch(uCorr, ivec2(0), 0).x;
    res.x = u;
  }
  ivec2 cv = c;
  if (perY && cv.y == uN.y) cv.y = 0;
  if (cv.x < uN.x) {
    float v = texelFetch(uVel, cv, 0).y;
    if (perY || (cv.y > 0 && cv.y < uN.y)) v -= fetchC(uPsi, cv) - fetchC(uPsi, cv - ivec2(0, 1));
    res.y = v;
  }
  o = vec4(res, 0.0, 1.0);
}
`;

  const PUPDATE = HEAD + `
uniform sampler2D uP;
uniform sampler2D uPsi;
uniform float uScale;
uniform float uShift;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  o = vec4(texelFetch(uP, c, 0).x + uScale * texelFetch(uPsi, c, 0).x - uShift, 0.0, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // Geometric multigrid for  Laplace(x) = rhs  (Neumann / periodic)
  // ---------------------------------------------------------------------------
  const MG_COMMON = `
uniform ivec2 uSize;
uniform ivec2 uPer;
bool nb(inout ivec2 q) {
  if (q.x < 0) { if (uPer.x == 1) q.x += uSize.x; else return false; }
  else if (q.x >= uSize.x) { if (uPer.x == 1) q.x -= uSize.x; else return false; }
  if (q.y < 0) { if (uPer.y == 1) q.y += uSize.y; else return false; }
  else if (q.y >= uSize.y) { if (uPer.y == 1) q.y -= uSize.y; else return false; }
  return true;
}
`;

  // One complete red-black Gauss-Seidel sweep in a single pass:
  // red cells from the old black neighbours, black cells from the red neighbours
  // just recomputed (identical to the sequential sweep).
  const MG_SMOOTH = HEAD + MG_COMMON + `
uniform sampler2D uX;
uniform sampler2D uRhs;
uniform float uH2;
uniform int uZero;
out vec4 o;
float X(ivec2 q) { return uZero == 1 ? 0.0 : texelFetch(uX, q, 0).x; }
float relaxRed(ivec2 q) {
  float s = 0.0, n = 0.0;
  ivec2 r;
  r = q + ivec2(1, 0); if (nb(r)) { s += X(r); n += 1.0; }
  r = q + ivec2(-1, 0); if (nb(r)) { s += X(r); n += 1.0; }
  r = q + ivec2(0, 1); if (nb(r)) { s += X(r); n += 1.0; }
  r = q + ivec2(0, -1); if (nb(r)) { s += X(r); n += 1.0; }
  return (s - uH2 * texelFetch(uRhs, q, 0).x) / max(n, 1.0);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (((c.x + c.y) & 1) == 0) { o = vec4(relaxRed(c), 0.0, 0.0, 1.0); return; }
  float s = 0.0, n = 0.0;
  ivec2 r;
  r = c + ivec2(1, 0); if (nb(r)) { s += relaxRed(r); n += 1.0; }
  r = c + ivec2(-1, 0); if (nb(r)) { s += relaxRed(r); n += 1.0; }
  r = c + ivec2(0, 1); if (nb(r)) { s += relaxRed(r); n += 1.0; }
  r = c + ivec2(0, -1); if (nb(r)) { s += relaxRed(r); n += 1.0; }
  o = vec4((s - uH2 * texelFetch(uRhs, c, 0).x) / max(n, 1.0), 0.0, 0.0, 1.0);
}
`;

  const MG_RESID_FUNC = `
uniform sampler2D uX;
uniform sampler2D uRhs;
uniform float uH2;
float resid(ivec2 q) {
  float xc = texelFetch(uX, q, 0).x;
  float s = 0.0, n = 0.0;
  ivec2 r;
  r = q + ivec2(1, 0); if (nb(r)) { s += texelFetch(uX, r, 0).x; n += 1.0; }
  r = q + ivec2(-1, 0); if (nb(r)) { s += texelFetch(uX, r, 0).x; n += 1.0; }
  r = q + ivec2(0, 1); if (nb(r)) { s += texelFetch(uX, r, 0).x; n += 1.0; }
  r = q + ivec2(0, -1); if (nb(r)) { s += texelFetch(uX, r, 0).x; n += 1.0; }
  return texelFetch(uRhs, q, 0).x - (s - n * xc) / uH2;
}
`;

  // Compute the residual and average it onto the coarser grid (target: coarse grid)
  const MG_RESTRICT = HEAD + MG_COMMON + MG_RESID_FUNC + `
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 2;
  o = vec4(0.25 * (resid(c) + resid(c + ivec2(1, 0)) + resid(c + ivec2(0, 1)) + resid(c + ivec2(1, 1))), 0.0, 0.0, 1.0);
}
`;

  // Residual on the fine grid (diagnostics only)
  const MG_RESIDUAL = HEAD + MG_COMMON + MG_RESID_FUNC + `
out vec4 o;
void main() { o = vec4(resid(ivec2(gl_FragCoord.xy)), 0.0, 0.0, 1.0); }
`;

  // Bilinear prolongation of the coarse-grid correction + addition (target: fine grid)
  const MG_PROLONG = HEAD + `
uniform sampler2D uX;
uniform sampler2D uCoarse;
uniform ivec2 uCSize;
uniform ivec2 uPer;
out vec4 o;
float C(ivec2 q) {
  if (uPer.x == 1) { if (q.x < 0) q.x += uCSize.x; else if (q.x >= uCSize.x) q.x -= uCSize.x; }
  else q.x = clamp(q.x, 0, uCSize.x - 1);
  if (uPer.y == 1) { if (q.y < 0) q.y += uCSize.y; else if (q.y >= uCSize.y) q.y -= uCSize.y; }
  else q.y = clamp(q.y, 0, uCSize.y - 1);
  return texelFetch(uCoarse, q, 0).x;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 p = c >> 1;
  ivec2 d = ivec2((c.x & 1) == 1 ? 1 : -1, (c.y & 1) == 1 ? 1 : -1);
  float e = (9.0 * C(p) + 3.0 * C(p + ivec2(d.x, 0)) + 3.0 * C(p + ivec2(0, d.y)) + C(p + d)) / 16.0;
  o = vec4(texelFetch(uX, c, 0).x + e, 0.0, 0.0, 1.0);
}
`;

  // Exact solve on the coarsest grid via the precomputed (pseudo-)inverse
  const MG_DIRECT = HEAD + `
uniform sampler2D uG;
uniform sampler2D uRhs;
uniform ivec2 uSize;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = c.y * uSize.x + c.x;
  int n = uSize.x * uSize.y;
  float s = 0.0;
  for (int j = 0; j < n; j++) {
    s += texelFetch(uG, ivec2(j, i), 0).x * texelFetch(uRhs, ivec2(j % uSize.x, j / uSize.x), 0).x;
  }
  o = vec4(s, 0.0, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // Initial conditions
  // ---------------------------------------------------------------------------
  const INIT_VEL = HEAD + COMMON + `
uniform int uMode;        // 0 at rest, 1 inflow profile everywhere, 2 Taylor-Green, 3 shear layer, 4 rigid-body test
uniform vec4 uP0;         // mode dependent
uniform vec4 uP1;
uniform vec4 uVort[8];    // x, y, strength, radius (Gaussian stream function)
uniform int uNVort;
uniform vec4 uNoise[8];   // kx, ky, amplitude, phase (stream-function modes)
uniform int uNNoise;
out vec4 o;
const float PI = 3.141592653589793;

float psi(vec2 p) {       // stream function at grid nodes
  float s = 0.0;
  for (int k = 0; k < uNVort; k++) {
    vec2 d = p - uVort[k].xy;
    s += uVort[k].z * exp(-dot(d, d) / (uVort[k].w * uVort[k].w));
  }
  for (int k = 0; k < uNNoise; k++) {
    s += uNoise[k].z * sin(uNoise[k].x * p.x + uNoise[k].w) * cos(uNoise[k].y * p.y + 1.7 * uNoise[k].w);
  }
  if (uMode == 3) {
    float yc = uP0.z * float(uN.y), sig = uP1.y * float(uN.y);
    float kx = 2.0 * PI * uP1.x / float(uN.x);
    float e = exp(-(p.y - yc) * (p.y - yc) / (sig * sig));
    s += uP0.w * e * (cos(kx * p.x) + 0.37 * cos(2.0 * kx * p.x + 1.3) + 0.21 * cos(3.0 * kx * p.x + 4.1)) / kx;
  }
  return s;
}

vec2 base(vec2 pu, vec2 pv) {   // analytic base flow at the u and v positions
  if (uMode == 1) return vec2(inflowU(pu.y), 0.0);
  if (uMode == 2) {
    float kx = 2.0 * PI * uP0.y / float(uN.x), ky = 2.0 * PI * uP0.z / float(uN.y);
    return vec2(uP0.x * sin(kx * pu.x) * cos(ky * pu.y),
                -uP0.x * sin(0.5 * kx) / sin(0.5 * ky) * cos(kx * pv.x) * sin(ky * pv.y));
  }
  if (uMode == 3) {
    float yc = uP0.z * float(uN.y);
    return vec2(uP0.x * tanh((pu.y - yc) / (uP0.y * float(uN.y))), 0.0);
  }
  return vec2(0.0);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 pu = vec2(c) + vec2(0.0, 0.5), pv = vec2(c) + vec2(0.5, 0.0);
  vec2 w = base(pu, pv);
  vec2 p = vec2(c);
  float p00 = psi(p);
  w.x += psi(p + vec2(0.0, 1.0)) - p00;
  w.y -= psi(p + vec2(1.0, 0.0)) - p00;
  bool perX = uBC.x == 2, perY = uBC.z == 2;
  if (c.y >= uN.y) w.x = 0.0;
  if (c.x >= uN.x) w.y = 0.0;
  if (!perX) {
    if (c.x == 0) w.x = (uBC.x == 3 && c.y < uN.y) ? inflowU(pu.y) : 0.0;
    if (c.x == uN.x && uBC.y != 4) w.x = 0.0;
  }
  if (!perY && (c.y == 0 || c.y == uN.y)) w.y = 0.0;
  o = vec4(w, 0.0, 1.0);
}
`;

  const INIT_SCAL = HEAD + COMMON + `
uniform int uDyeMode;     // 0 empty, 1 two layers, 2 vertical stripes, 3 horizontal stripes, 5 checkerboard, 6 same as inflow
uniform vec4 uDyeP;       // mode dependent (x: count / interface position)
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec4 uBlob[8];    // x, y, radius, colour index
uniform vec3 uBlobCol[8];
uniform int uNBlob;
uniform int uTMode;       // 0 constant, 1 linear bottom->top + noise, 2 two layers
uniform vec4 uTP;         // T0, T1, noise amplitude, interface position
out vec4 o;
float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 s = p / vec2(uN);
  vec3 dye = vec3(0.0);
  if (uDyeMode == 1) {
    float w = smoothstep(-1.0, 1.0, p.y - uDyeP.x * float(uN.y));
    dye = mix(uColB, uColA, w);
  } else if (uDyeMode == 2) {
    float k = floor(s.x * uDyeP.x);
    dye = mod(k, 2.0) < 0.5 ? uColA : uColB;
  } else if (uDyeMode == 3) {
    float k = floor(s.y * uDyeP.x);
    dye = mod(k, 2.0) < 0.5 ? uColA : uColB;
  } else if (uDyeMode == 5) {
    float k = floor(s.x * uDyeP.x) + floor(s.y * uDyeP.x * float(uN.y) / float(uN.x));
    dye = mod(k, 2.0) < 0.5 ? uColA : uColB;
  } else if (uDyeMode == 6) {
    dye = inflowS(p.y).rgb;
  }
  for (int k = 0; k < uNBlob; k++) {
    vec2 d = p - uBlob[k].xy;
    float w = smoothstep(uBlob[k].z + 1.0, uBlob[k].z - 1.0, length(d));
    dye = mix(dye, uBlobCol[k], w);
  }
  float T = uTP.x;
  if (uTMode == 1) T = mix(uTP.x, uTP.y, s.y) + uTP.z * (hash(p) - 0.5);
  else if (uTMode == 2) T = mix(uTP.x, uTP.y, smoothstep(-1.0, 1.0, p.y - uTP.w * float(uN.y))) + uTP.z * (hash(p) - 0.5);
  o = vec4(dye, T);
}
`;

  // Solid mask from analytic shapes (volume fraction ~ clamp(0.5 - sdf))
  const INIT_MASK = HEAD + `
uniform vec4 uShapeA[8];  // type (0 circle, 1 box, 2 ellipse), x, y, angle
uniform vec4 uShapeB[8];  // semi-axes a, b
uniform int uNShape;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  float chi = 0.0;
  for (int k = 0; k < uNShape; k++) {
    vec2 d = p - uShapeA[k].yz;
    float ca = cos(uShapeA[k].w), sa = sin(uShapeA[k].w);
    d = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
    vec2 h = uShapeB[k].xy;
    float sd;
    if (uShapeA[k].x < 0.5) sd = length(d) - h.x;
    else if (uShapeA[k].x < 1.5) { vec2 q = abs(d) - h; sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
    else { float k0 = length(d / h); float k1 = length(d / (h * h)); sd = k0 * (k0 - 1.0) / max(k1, 1e-6); }
    chi = max(chi, clamp(0.5 - sd, 0.0, 1.0));
  }
  o = vec4(chi, 0.0, 0.0, 1.0);
}
`;

  // Draw / erase the mask with the cursor
  const MASK_DRAW = HEAD + TOOL + `
uniform sampler2D uMask;
uniform int uErase;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, c, 0).x;
  float w = clamp(uToolPar.x + 0.5 - toolDist(vec2(c) + 0.5), 0.0, 1.0);
  o = vec4(uErase == 1 ? min(m, 1.0 - w) : max(m, w), 0.0, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------
  const STATS = HEAD + COMMON + RHS_FUNCS + `
uniform sampler2D uMask;
uniform int uWhich;   // 0: sums A, 1: maxima B, 2: sums C (forces), 3: maxima D
out vec4 o;
float vort(ivec2 c) {  // vorticity at node (i,j)
  return (fetchV(uVel, c) - fetchV(uVel, c + ivec2(-1, 0))) - (fetchU(uVel, c) - fetchU(uVel, c + ivec2(0, -1)));
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 w = texelFetch(uVel, c, 0).xy;
  float uR = fetchU(uVel, c + ivec2(1, 0)), vT = fetchV(uVel, c + ivec2(0, 1));
  if (uWhich == 0 || uWhich == 1) {
    float w0 = vort(c), w1 = vort(c + ivec2(1, 0)), w2 = vort(c + ivec2(0, 1)), w3 = vort(c + ivec2(1, 1));
    float d = uR - w.x + vT - w.y;
    if (uWhich == 0) {
      o = vec4(0.25 * (w.x * w.x + uR * uR + w.y * w.y + vT * vT),
               0.125 * (w0 * w0 + w1 * w1 + w2 * w2 + w3 * w3),
               d * d, texelFetch(uPres, c, 0).x);
    } else {
      o = vec4(max(abs(w.x), abs(uR)) + max(abs(w.y), abs(vT)),
               length(vec2(0.5 * (w.x + uR), 0.5 * (w.y + vT))),
               max(max(abs(w0), abs(w1)), max(abs(w2), abs(w3))), abs(d));
    }
  } else if (uWhich == 2) {
    // Force on immersed bodies from the momentum balance: sum of N(u) - grad(p) over all faces
    // on which the forcing acts (chi > 0). In divergence form this is exactly the surface integral
    // of momentum flux, pressure and shear stress over the hull of the body.
    // In addition the momentum M in this region: force on the body = sum(N - grad p) - dM/dt.
    bool perX = uBC.x == 2, perY = uBC.z == 2;
    float fx = 0.0, fy = 0.0, mx = 0.0, my = 0.0;
    float mc = texelFetch(uMask, c, 0).x;
    if (perX || c.x > 0) {
      if (mc + fetchC(uMask, c - ivec2(1, 0)) > 0.0) { fx = tendU(c); mx = w.x; }
    }
    if (perY || c.y > 0) {
      if (mc + fetchC(uMask, c - ivec2(0, 1)) > 0.0) { fy = tendV(c); my = w.y; }
    }
    o = vec4(fx, fy, mx, my);
  } else {
    float p = texelFetch(uPres, c, 0).x;
    float T = texelFetch(uScal, c, 0).a;
    o = vec4(p, -p, T, -T);
  }
}
`;

  const REDUCE = HEAD + `
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uMode;   // 0 sum, 1 maximum
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 8;
  vec4 acc = uMode == 1 ? vec4(-1e30) : vec4(0.0);
  for (int dy = 0; dy < 8; dy++) {
    for (int dx = 0; dx < 8; dx++) {
      ivec2 q = c + ivec2(dx, dy);
      if (q.x < uSrcSize.x && q.y < uSrcSize.y) {
        vec4 v = texelFetch(uSrc, q, 0);
        acc = uMode == 1 ? max(acc, v) : acc + v;
      }
    }
  }
  o = acc;
}
`;

  // Probe: local values at the cursor position (2 texels)
  const PROBE = HEAD + COMMON + `
uniform sampler2D uVel;
uniform sampler2D uPres;
uniform sampler2D uScal;
uniform sampler2D uMask;
uniform vec2 uPos;
out vec4 o;
float vort(ivec2 c) {
  return (fetchV(uVel, c) - fetchV(uVel, c + ivec2(-1, 0))) - (fetchU(uVel, c) - fetchU(uVel, c + ivec2(0, -1)));
}
void main() {
  ivec2 c = clamp(ivec2(floor(uPos)), ivec2(0), uN - 1);
  vec2 w = texelFetch(uVel, c, 0).xy;
  float uR = fetchU(uVel, c + ivec2(1, 0)), vT = fetchV(uVel, c + ivec2(0, 1));
  if (int(gl_FragCoord.x) == 0) {
    float om = 0.25 * (vort(c) + vort(c + ivec2(1, 0)) + vort(c + ivec2(0, 1)) + vort(c + ivec2(1, 1)));
    o = vec4(0.5 * (w.x + uR), 0.5 * (w.y + vT), texelFetch(uPres, c, 0).x, om);
  } else {
    vec4 s = texelFetch(uScal, c, 0);
    o = vec4(s.a, (s.r + s.g + s.b) / 3.0, texelFetch(uMask, c, 0).x, uR - w.x + vT - w.y);
  }
}
`;

  NS.shaders = {
    HEAD, COMMON, TOOL, RHS_FUNCS,
    RHS, RKC, SCALAR, OUTFLOW, DIV, GRADSUB, PUPDATE,
    MG_SMOOTH, MG_RESTRICT, MG_RESIDUAL, MG_PROLONG, MG_DIRECT,
    INIT_VEL, INIT_SCAL, INIT_MASK, MASK_DRAW,
    STATS, REDUCE, PROBE,
  };
})();
