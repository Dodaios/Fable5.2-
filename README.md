# Flow Lab – Navier–Stokes in the browser

An interactive fluid simulation as a plain website: pick a fluid, drag through it with the mouse or a
finger and watch vortices form, travel and decay through friction.

This is not a graphics effect. Behind it is a complete solver for the **incompressible
Navier–Stokes equations** in real SI units that runs directly on the graphics card (WebGL 2) and is
checked against known exact solutions and benchmarks from the literature.

![Flow Lab](docs/screenshot.png)

## Getting started

The site consists of static files only – no build step, no dependencies, no server required.

- **As a website (GitHub Pages):** in the repository, go to *Settings → Pages → Build and deployment*,
  choose the source "Deploy from a branch", select the branch and the folder `/ (root)`, and save.
  After about a minute the site is available at `https://<user>.github.io/<repository>/`.
- **Locally:** open `index.html` with a double click – or run `python3 -m http.server 8080` in the
  project folder and open `http://localhost:8080`.

You need a current browser with WebGL 2 (Chrome, Edge, Firefox, Safari 15 or later). On start-up the page
briefly measures the performance of the graphics card and picks a suitable grid resolution.
The URL parameters `?res=<cells across the height>` and `?scenario=<id>` override the resolution and the
start scenario (ids: `tank`, `karman`, `plate`, `cavity`, `kh`, `jet`, `benard`, `tg`).

## Usage in brief

| Area | Function |
|---|---|
| Scenario (top) | Open tank, Kármán vortex street, inclined plate, lid-driven cavity, Kelvin–Helmholtz instability, jet, Rayleigh–Bénard convection, Taylor–Green vortex |
| Tools (bottom) | **Stir** (drags the fluid along), **Dye** (marks the fluid without disturbing it), **Rod** (solid round rod at the cursor), **Wall** / **Eraser** (draw obstacles), for convection **Heat** / **Cool** |
| View (top right of the image) | Dye, vorticity, speed, pressure, temperature; optional overlays: particle streaks and velocity arrows |
| Fluid | Water, air, honey, glycerin, oils, mercury … or a **custom fluid** defined by density ρ and viscosity μ |
| Scale & forcing | Size of the domain and inflow/lid velocity in SI units; from these the Reynolds number with a classification of the flow regime |
| Measurements | simulated time, time step, kinetic energy, enstrophy, residual divergence, drag/lift coefficient, Strouhal number, probe at the cursor; export as CSV / PNG |

Keys: space = pause, `.` = single step, `R` = reset, `1`–`5` = view, `P` = particles, `V` = arrows.

## What exactly is being computed?

```
ρ (∂u/∂t + (u·∇)u) = −∇p + μ ∇²u + f          conservation of momentum
            ∇·u = 0                            conservation of mass (incompressible)
∂c/∂t + ∇·(u c) = D ∇²c                        dye (D = 0) and temperature
```

- **Newtonian fluid of constant density and viscosity**, two-dimensional.
- **Real units:** domain size in metres, velocities in m/s, material properties ρ and μ of the selected
  fluid. Displayed times, pressures (Pa), energies (J per metre of depth) and forces (N/m) are physical quantities.
- **No artificial viscosity:** the only friction in the central scheme is the molecular viscosity ν = μ/ρ.
  The "resolved (DNS)" indicator reports whether the grid still resolves the smallest structures (∼ L/√Re).
- **Cursor true to scale:** in the open tank the cursor movement corresponds to that of a stirring rod at the
  selected scale (one tank height per second on screen = H m/s).
- **Heat (Rayleigh–Bénard scenario):** Boussinesq approximation, buoyancy g β (T − T₀), thermal diffusivity κ.

### Numerical method

| Component | Method |
|---|---|
| Grid | staggered MAC grid (Harlow & Welch 1965), square cells; velocities on cell faces, pressure and scalars at cell centres |
| Advection | finite volumes in divergence form, 2nd-order central interpolation – discretely conserves mass, momentum and (in the inviscid limit) kinetic energy; optionally, or automatically where the cell Péclet number exceeds 2, a local 3rd-order QUICK upwind correction |
| Time | 3rd-order SSP Runge–Kutta (Shu & Osher 1988), projection in every stage, adaptive time step (CFL ≤ 0.75) |
| Viscous fluids | as soon as the explicit viscous limit becomes binding (cell Reynolds number ≲ 1): incremental pressure-correction scheme; viscosity is integrated with damped 2nd-order Runge–Kutta–Chebyshev stages (stabilised explicit, steady states exact), advection and pressure coupling are 1st order there |
| Pressure | exact discrete projection; Poisson equation solved by geometric multigrid (V-cycles, red–black Gauss–Seidel, exact solve on the coarsest grid via a pre-inverted matrix) |
| Scalars | conservative flux form, 3rd-order upwind scheme with Koren limiter (shape-preserving, no over- or undershoots) |
| Boundaries | no-slip and free-slip walls, moving wall, periodic, inflow (uniform, parabolic, jet), convective outflow with mass-flux correction |
| Obstacles | immersed boundaries with direct forcing on a volume-fraction mask (1st order at curved contours) |
| Precision | 32-bit floating-point textures; all solver accesses exact via `texelFetch` (no texture filtering) |

Internally the solver works non-dimensionally in grid units (Δx = 1, velocity in units of the reference
velocity U₀, viscosity = 1/cell Reynolds number); `js/app.js` converts to SI units.

## Validation

The tests run in a real browser against the same GPU code as the website (`node tests/validate.js`,
see below). Current results (SwiftShader software rendering, 32-bit floating point):

| Test case | Quantity checked | Result |
|---|---|---|
| Multigrid Poisson solver | residual reduction per V(1,1) cycle, random right-hand side, all boundary types | factor 0.05 – 0.14; round-off level (10⁻⁶) after 6 cycles |
| Projection | max. divergence of a random field after 8 cycles | 1.8 → 3·10⁻⁷ |
| Taylor–Green vortex (exact solution) | kinetic energy after one half-life, N = 16 / 32 / 64 | deviation 0.89 % / 0.22 % / 0.058 % → **order 2.0 in space**; time error < 3·10⁻⁵; residual divergence 6·10⁻⁸ |
| Poiseuille flow | steady parabolic profile, explicit and in stiff mode (ν up to 200) | error = h² (0.39 % at 16, 0.098 % at 32 cells) – exactly the expected discretisation error |
| Decaying shear wave | amplitude against exp(−νk²t) | RK3: 10⁻⁵; stiff mode (RKC): 0.04 % at Δt = 1, **order 2.0 in time** |
| Lid-driven cavity, Re = 100, 64² | velocity profiles on the centrelines | max. deviation from Ghia et al. (1982): 0.004 (u), 0.009 (v). Extrema u_min = −0.2128, v_max = 0.1785, v_min = −0.2527 compared with highly accurate spectral solutions (−0.2140 / 0.1796 / −0.2538, Botella & Peyret 1998): deviation ≤ 0.6 % |
| Cylinder in a channel, Re = 100 (Schäfer & Turek 1996, case 2D-2), only 20 cells per diameter | Strouhal number, c_D,max, c_L,max | St = 0.302 (reference 0.295 – 0.305) ✓; c_D,max = 3.15 (reference 3.22 – 3.24, −2.5 %); c_L,max = 0.77 (reference 0.99 – 1.01) – at this coarse resolution of the body the lift amplitude is clearly too small |

## Limits – what the simulation is not

- **Two-dimensional.** Real turbulence is three-dimensional (vortex stretching, energy cascade to small scales).
  In 2D, energy moves towards large vortices. The behaviour corresponds to thin layers, soap films or
  strongly stratified/rotating flows – not to a turbulent tap.
- **No free surface, no compressibility, no multiphase flow.** Waves, splashes, sound and
  droplets do not occur; "water" means the interior of a completely filled chamber.
- **Resolution is finite.** At large Reynolds numbers (e.g. water in a 1 m tank, Re ∼ 10⁶) the
  smallest vortices are smaller than the grid. The page then reports "under-resolved"; the QUICK correction
  acts as an implicit subgrid model – qualitatively plausible, but no longer a direct numerical simulation.
- **Very viscous fluids** (honey, glycerin) even out velocity differences faster than a single frame lasts.
  Steady states are exact; the transients themselves are resolved with only a few steps in "real time"
  (choose slow motion to follow them accurately).
- **Obstacles** have staircase accuracy (1st order). Shedding frequency and drag agree to within a few
  per cent; the lift fluctuation is noticeably underestimated for coarsely resolved bodies (see Validation).
- **Material properties** are reference values at 20 °C; real fluids such as honey depend on temperature and are partly non-Newtonian.
- **Real time** depends on the graphics card. If the performance is not sufficient, the simulation keeps running
  in slow motion and says so, instead of distorting the physics.

## Structure

```
index.html          page and controls
css/style.css       styling
js/gl.js            WebGL 2 helper layer (programs, float textures, framebuffers)
js/shaders.js       GLSL sources of the solver (boundary conditions, advection, multigrid, diagnostics)
js/solver.js        time stepping, projection, multigrid control, diagnostics readback
js/render.js        field views, colour scales, particles, arrows
js/fluids.js        material data
js/scenarios.js     scenarios (boundaries, initial fields, obstacles)
js/app.js           user interface, time control, conversion grid ↔ SI
tests/              validation in a headless browser (Playwright)
```

## Running the tests

```bash
npm install            # installs Playwright (only needed for the tests)
npx playwright install chromium
npm test               # quick tests against analytical solutions (a few minutes)
npm run test:cavity    # node tests/cavity.js 100 64   – cavity against Ghia et al.
npm run test:cylinder  # node tests/cylinder.js 80 130 – cylinder benchmark of Schäfer & Turek (long)
node tests/smoke.js    # loads every scenario and stirs in several fluids
```

## References

- F. H. Harlow, J. E. Welch: *Numerical calculation of time-dependent viscous incompressible flow of fluid with free surface*, Phys. Fluids 8 (1965).
- A. J. Chorin: *Numerical solution of the Navier-Stokes equations*, Math. Comp. 22 (1968).
- C.-W. Shu, S. Osher: *Efficient implementation of essentially non-oscillatory shock-capturing schemes*, J. Comput. Phys. 77 (1988).
- B. P. Leonard: *A stable and accurate convective modelling procedure based on quadratic upstream interpolation*, Comput. Methods Appl. Mech. Eng. 19 (1979).
- B. Koren: *A robust upwind discretization method for advection, diffusion and source terms*, in: Numerical Methods for Advection-Diffusion Problems (1993).
- B. P. Sommeijer, L. F. Shampine, J. G. Verwer: *RKC: An explicit solver for parabolic PDEs*, J. Comput. Appl. Math. 88 (1998).
- E. A. Fadlun, R. Verzicco, P. Orlandi, J. Mohd-Yusof: *Combined immersed-boundary finite-difference methods for three-dimensional complex flow simulations*, J. Comput. Phys. 161 (2000).
- U. Ghia, K. N. Ghia, C. T. Shin: *High-Re solutions for incompressible flow using the Navier-Stokes equations and a multigrid method*, J. Comput. Phys. 48 (1982).
- O. Botella, R. Peyret: *Benchmark spectral results on the lid-driven cavity flow*, Comput. Fluids 27 (1998).
- M. Schäfer, S. Turek: *Benchmark computations of laminar flow around a cylinder*, in: Flow Simulation with High-Performance Computers II, Vieweg (1996), pp. 547–566.

License: MIT (see `LICENSE`).
