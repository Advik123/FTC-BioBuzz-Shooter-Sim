# BIOBUZZ Launcher Simulator

A 3D simulator for shooting POLLEN into a BIOBUZZ Hive Cell (FTC 2026-27) with a
hooded flywheel launcher: the flywheel sits above the ball and the ball rolls up
an adjustable ramp. It is plain Three.js loaded from a CDN, with no build step.
The physics code is pure ES modules with no DOM or Three.js imports, so the same
code runs in the browser, in a Web Worker and under `node --test`.

## Running

The app uses ES modules and a module Web Worker, so it must be served over HTTP.
Opening `index.html` from disk will not work.

```bash
npx serve .              # or: npm run serve
# or
python -m http.server 8000
```

Then open the printed URL (for example `http://localhost:8000`). You need an
internet connection the first time, because Three.js 0.170 is loaded from jsDelivr
through the import map in `index.html`.

Tests (Node 18 or newer, no dependencies):

```bash
npm test                 # = node --test  (runs tests/*.test.mjs)
```

## Using it

- **Target.** Choose the red or blue Hive and the audience-side or scoring-side
  Cell. The chosen Cell is always shown in its upward, scorable state (G417); the
  other Hive stays in its match-start state. Click or drag on the Cell-floor map
  to pick the landing spot. *u* runs across the Cell; *s* is depth from the pivot
  axis.
- **Shooter position.** Set the horizontal distance from the release point to the
  bottom lip of the Cell opening, a lateral offset, and the release height.
- **Launcher.** Set the motor (goBILDA 5203 Yellow Jacket, published free speeds),
  motor RPM (capped at free speed), ramp angle, flywheel diameter, gear ratio
  (motor turns per flywheel turn, default 1:1), slip/efficiency %, and spin mode.
- **Fire** (or press Space) animates the shot and leaves a fading trail; up to
  10 trails are kept. The dashed line is a live preview that updates as you edit.
  A POLLEN that scores stays in the Cell and acts as an obstacle for later shots.
  **Clear Hive** removes balls from the target Cell, including the optional
  pre-staged NECTAR.
- **Readouts:** make or miss with a reason, exit speed, flight time (to the first
  contact or opening crossing), apex height, wheel RPM, entry angle at the opening
  plane, and rim clearance.
- **Reverse solver.** By default finds (ramp angle, RPM) pairs where the ball
  **ends inside the target Cell** after full collision physics (no rolling out onto
  the floor). Results are split into **low-arc** and **high-arc** families and
  ranked by your criterion. Optional checkboxes require an exact floor landing spot
  or enforce the 18 in. robot footprint for solver results only. **Lock RPM** or
  **Lock ramp angle** (under Launcher) so the solver only adjusts the other
  variable. **Load into simulator** copies a solution into the launcher inputs.
- All settings persist in `localStorage`. **Reset** restores the defaults.

## Project layout

```
index.html, styles.css        UI shell (import map -> three@0.170.0)
src/main.js                   wiring: state, persistence, events
src/field/dimensions.js       every field dimension with a source tag
src/field/geometry.js         Cell frames, colliders, coordinate helpers (shared by physics and rendering)
src/physics/                  ball, motors, launcher, integrator, collisions, simulate, solver, solverWorker
src/render/                   Three.js scene, tiles, Hive, perimeter, trajectory, shooter, DOM helpers
tests/physics.test.mjs        node:test suite
tools/step_extract.py         dependency-free STEP assembly / bounding-box extractor
```

**Field frame.** The origin is at the field centre on the tile top. +X points
toward the BLUE alliance wall, +Y away from the audience (toward the scoring
table), and +Z is up. Dimensions are stored in inches; the physics runs in SI
units.

## Physics model and assumptions

### Launcher (hooded flywheel, ball squeezed against a ramp)

```
wheel_rpm     = motor_rpm / gear_ratio
v_surface     = wheel_rpm * 2*pi/60 * (D_wheel / 2)
v_exit        = eta * v_surface / 2            (eta = slip/efficiency)
omega_ball    = v_exit / r_ball                (rolls without slipping on the ramp)
direction     = ramp angle above horizontal, aimed at the landing spot
```

The factor of 1/2 comes from the ball rolling between a moving surface (the
wheel) and a stationary one (the ramp): its centre moves at half the contact
speed. Motor load, flywheel energy drop per shot, and ramp friction are all
folded into eta.

> **Spin direction (important).** With the flywheel **above** the ball and the
> ramp **below**, the top of the ball is driven forward and the bottom is held
> back. That is **topspin**, and the Magnus force from topspin points **down**.
> The common "backspin gives lift" intuition applies to launchers where the wheel
> is **below** the ball (or the ball rolls along a hood above it). The simulator
> therefore defaults to **topspin**. Backspin and no-spin are available as
> overrides in the Spin selector, so you can compare them or model a different
> mechanism.

### Flight

The integrator is fixed-step RK4 with dt = 0.5 ms (the solver's inner loop uses
1 ms). Forces:

```
F_gravity = -m g z
F_drag    = -1/2 rho Cd A |v| v                       Cd = 0.5   (smooth sphere, Re ~ 2-4e4)
F_magnus  =  1/2 rho Cl A |v|^2 (omega x v)/|omega x v|
Cl        = min(clMax, clSlope * S),  S = r|omega|/|v|   clSlope = 0.6, clMax = 0.35
```

- Spin is held constant in flight. Spin decay over a flight of less than 1 s is
  small.
- Air density defaults to 1.204 kg/m^3 (20 °C, sea level).
- Cd, Cl slope, Cl max and air density can be edited, and drag and Magnus can
  each be turned off, under *Advanced physics*.

### Collisions

- **Geometry.** The Cell is a convex 7-sided tube. Its skin walls, back skin, rim
  and outer rib bands are two-sided convex polygons. The frame legs and top bar
  are capsules, the logo panels are polygons, and resting balls are static
  spheres.
- **Impulse.** Normal restitution is *e*. Tangential impulse follows Coulomb
  friction μ, capped at the impulse that stops sliding. Friction is coupled to
  spin, with the ball treated as a thin hollow shell (I = 2/3 m r²).
- **Contact handling.**
  - Penetration is removed by positional correction.
  - Below 0.05 m/s normal speed the contact becomes inelastic (resting).
  - A small rolling-resistance deceleration (0.02 g) applies while touching.
  - The ball is at rest after staying below 0.03 m/s for 0.25 s.
- **Miss rules.** Any contact with the floor tiles counts as a miss. The shot
  also ends if the ball leaves the field.
- **Make** means the ball's final position is inside the target Cell volume
  (the inner cross-section, between the back skin and the opening plane).
- **Not simulated:** Hive tipping or rotation (the Hive is static), Cell skin
  flex, and ball deformation.

### Reverse solver

**Score in cell (default).** For each ramp angle from 5° to 85°, the solver
searches for the **lowest exit speed** (then motor RPM) for which the **full**
collision simulation reports a **make** (ball ends in the target Cell, not on
the floor). The landing dot on the floor map is only used to aim the shooter
heading in the forward sim; it does not have to be hit. The angle with the
minimum scoring speed splits **low-arc** and **high-arc** families. Robustness
(in score mode) is how many of ±2 % RPM still score.

**Exact landing (optional).** Enable *Require landing on the picked floor spot*.
Then the solver uses free-flight bisection toward that point and requires first
contact within 1 in. of it. That mode is stricter and often finds no low-arc
solutions because the Cell floor rises 30° toward the opening.

Ranking criteria: lowest RPM, flattest arc, steepest entry, largest rim
clearance, most robust, and shortest flight time.

By default the solver **does not** reject solutions when the modeled 18 in.
robot footprint extends past the field edge (corner shots); turn on *Block solver
if robot footprint is outside the field* to restore that check. The violations
list for manual Fire still shows footprint warnings.

### Constraints

All of these are editable in the *Robot constraints* panel.

- **Maximum shooter height.** The default is 29 in. (R105 expanded height). It is
  checked against the release height, which is the top of the ramp.
- **Ramp angle range.** Minimum and maximum ramp angle, 15–75° by default.
- **Maximum motor RPM.** Set as a percentage of free speed.
- **Distance range.** Minimum and maximum shooter distance.
- **18 in. starting cube.** An optional check (R102) for a launcher with a fixed
  angle that cannot extend. It caps the release height at 18 in., limits the
  horizontal length of the ramp plus the wheel to 18 in., and requires the bottom
  of the ramp to stay above the floor.
- **Robot footprint.** An 18 × 18 in. footprint behind the release point must be
  inside the field and off the Hive frame base.
- **Launch zones.** The manual has **no launch-zone rule** for scoring into the
  Hive. The only launch-related rule found is G417 (only into the upward Cell).
  If a launch zone or Team Update appears, add it in `checkConstraints()` in
  `src/physics/solver.js`.

## Sources

Every dimension lives in `src/field/dimensions.js` with a source tag:
`manual`, `checklist`, `guide`, `cad` or `placeholder`. The app shows the full
table under *Dimension sources*. The main sources are:

- *Competition Manual Section 9*: field, Hive frame, Cell, Flower and game-piece
  sizes. These are nominal values (±1 in.).
- *Field Acceptance Checklist 26-27*: the bottom of the upright Cell opening is
  53.5 ± 0.5 in. The model gives 53.38 in., which a test checks.
- *Official STEP CAD (Field CAD v26-27.2)*: frame members, Cell tilt (30.0°),
  Cell depth range along the axis, Cell inner profile, tile pitch, tape positions
  and Flower locations.
- *goBILDA product pages*: Yellow Jacket 5203 free speed and stall torque.

### Measuring from the CAD

`tools/step_extract.py` is a dependency-free STEP AP214 parser. It rebuilds the
assembly tree (NAUO / CDSR / ITEM_DEFINED_TRANSFORMATION) and prints world-space
bounding boxes per part:

```bash
python tools/step_extract.py field.step "Goal Rib" "A-Frame"     # bounding boxes
python tools/step_extract.py field.step --dump "Goal Rib" --out rib.json   # vertex cloud
```

The CAD is in Onshape axes (Y up, audience at +Z). The tool reports inches in
that frame. The field frame used here is (x, −z, y) of the CAD frame.

## Needs verification

These values were not found in an official source, or the official sources
disagree. They are tagged `placeholder` in `dimensions.js` or noted here.

1. **Material properties (all placeholders).** These matter most for "bounced in
   or out" outcomes and should be calibrated with high-speed video of real
   bounces.
   - Restitution: Cell skin 0.45, Goal Rib 0.5, frame 0.55, ball-on-ball 0.5.
   - Friction: 0.3 for skin, frame and ball; 0.4 for the Goal Rib.
2. **Aerodynamics (literature values, not measured on POLLEN).** Cd = 0.5,
   Cl = min(0.35, 0.6·S). POLLEN surface texture can change both.
3. **Ball inertia.** The ball is modelled as a thin hollow shell
   (I = 2/3 m r²); the wall thickness is unknown.
4. **Rolling resistance.** 0.02 g while in contact. This mostly affects how
   quickly a ball settles.
5. **Field size.** The CAD perimeter's inner faces are 141.16 in. apart (±70.58),
   while the manual says about 144 in. The simulator uses the CAD value. Real
   fields vary.
6. **Cell inner profile.** Sampled from CAD vertices, with fillets approximated
   by chamfers. The opening is 20.2 × 14.27 in. in the CAD versus about
   20 × 14 in. in the manual.
7. **Pre-staged NECTAR positions.** Three NECTAR placed in a row along the back
   of the Cell floor is an approximation of the setup guide, not a measured
   layout.
8. **Rim, rib and lip details.** The rim lip is 0.35 in. and the rib is 2 in.
   thick, both from the CAD bounding geometry. Small changes move marginal
   rim-clip results.
9. **Launcher model.** The 1/2 factor assumes no-slip rolling against a rigid
   ramp. Ball compression, wheel compliance and the drop in flywheel RPM per shot
   are folded into the efficiency %, which should be calibrated by measuring exit
   speed (for example with high-speed video or a chronograph).
10. **Launch-zone rules.** None were found in the manual. Check the latest Team
    Updates.

## Limitations and calibration tips

- The Hive is static: it does not tip, swing or flex.
- Spin is constant in flight, and the air is still.
- There is no ball-ball interaction between two balls in flight. Balls already
  resting in the Cell are static obstacles.
- To calibrate, measure exit speed at a few RPMs and set efficiency so that
  `v_exit` matches. Then compare apex height or range with drag on, and adjust Cd.
  Finally, compare bounce heights off the Cell skin and adjust restitution.
