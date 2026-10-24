// Reverse solver: find (ramp angle, motor RPM) pairs for the target upward Cell.
//
// Score mode (default): lowest exit speed per angle that ends with the ball
// inside the Cell (full collision sim). Exact floor landing spot is optional.
//
// Exact landing mode: bisect on exit speed so free flight passes through the
// picked floor point, then require first contact within 1 in. of that spot.
//
// Method
//  1. Sweep ramp angle.
//  2. Per angle, pick exit speed (make-search or vacuum bisection).
//  3. U-shaped speed vs angle splits low-arc / high-arc families.
//  4. Full collision validation, constraints, rank.

import { POLLEN } from './ball.js';
import { rk4Step, DEFAULT_AERO } from './integrator.js';
import { launchState, motorRpmForExitSpeed, launchFromSetup } from './launcher.js';
import { motorById } from './motors.js';
import { shotGeometry, runShot, buildEnvironment } from './simulate.js';
import { D, IN } from '../field/dimensions.js';

export const CRITERIA = Object.freeze({
  rpm: { label: 'Lowest motor RPM', key: 'motorRpm', dir: 1 },
  apex: { label: 'Flattest arc (lowest apex)', key: 'apexIn', dir: 1 },
  entry: { label: 'Steepest entry angle', key: 'entryDescentDeg', dir: -1 },
  clearance: { label: 'Largest rim clearance', key: 'clearanceIn', dir: -1 },
  robust: { label: 'Most robust to RPM error', key: 'sensitivityIn', dir: 1 },
  time: { label: 'Shortest flight time', key: 'flightTime', dir: 1 },
});

export function defaultConstraints() {
  return {
    maxShooterHeightIn: D.expansionHeight, // R105: 29 in. when expanded
    minRampDeg: 15,
    maxRampDeg: 75,
    fitStartingCube: false, // shooter must fit (un-extended) in the 18 in. cube
    rampLengthIn: 8,
    maxRpmFraction: 1.0, // of the selected motor's free speed
    minDistanceIn: 0,
    maxDistanceIn: 140,
    robotLengthIn: D.startingCube, // footprint behind the release point
    robotWidthIn: D.startingCube,
    /** If false (default), valid = ball ends in the Cell; landing dot is not required. */
    requireExactLanding: false,
    /** If false (default), footprint is still shown in the panel but does not block solver results. */
    enforceFootprintInSolver: false,
    /** Reverse solver holds cfg.motorRpm fixed and sweeps ramp angle only. */
    lockMotorRpm: false,
    /** Reverse solver holds cfg.rampAngleDeg fixed and sweeps motor RPM only. */
    lockRampAngle: false,
  };
}

const sq = (x) => x * x;

/** Constraint check for a fully specified config. Returns a list of violations. */
export function checkConstraints(cfg, k, geo = shotGeometry(cfg)) {
  const v = [];
  const motor = motorById(cfg.motorId);
  const maxRpm = motor.freeSpeedRpm * k.maxRpmFraction;
  if (cfg.motorRpm > maxRpm + 1e-6) v.push(`motor RPM ${cfg.motorRpm.toFixed(0)} > ${maxRpm.toFixed(0)}`);
  if (cfg.rampAngleDeg < k.minRampDeg - 1e-9) v.push(`ramp ${cfg.rampAngleDeg.toFixed(1)} deg < min ${k.minRampDeg}`);
  if (cfg.rampAngleDeg > k.maxRampDeg + 1e-9) v.push(`ramp ${cfg.rampAngleDeg.toFixed(1)} deg > max ${k.maxRampDeg}`);
  const maxH = k.fitStartingCube ? Math.min(k.maxShooterHeightIn, D.startingCube) : k.maxShooterHeightIn;
  if (cfg.releaseHeightIn > maxH + 1e-9) v.push(`release height ${cfg.releaseHeightIn} in. > ${maxH} in.`);
  if (cfg.releaseHeightIn < POLLEN.radiusIn) v.push('release height below ball radius');
  if (k.fitStartingCube) {
    const th = (cfg.rampAngleDeg * Math.PI) / 180;
    const horiz = k.rampLengthIn * Math.cos(th) + cfg.wheelDiameterIn;
    if (horiz > D.startingCube) v.push(`ramp + wheel ${horiz.toFixed(1)} in. long, exceeds 18 in. cube`);
    if (k.rampLengthIn * Math.sin(th) > cfg.releaseHeightIn) {
      v.push('ramp would start below the floor at this release height');
    }
  }
  if (cfg.distanceIn < k.minDistanceIn) v.push(`distance ${cfg.distanceIn} in. < min ${k.minDistanceIn}`);
  if (cfg.distanceIn > k.maxDistanceIn) v.push(`distance ${cfg.distanceIn} in. > max ${k.maxDistanceIn}`);
  const fp = footprint(geo.releaseIn, geo.heading, k.robotLengthIn, k.robotWidthIn);
  if (fp.some(([x, y]) => Math.abs(x) > D.fieldHalf + 1e-6 || Math.abs(y) > D.fieldHalf + 1e-6)) {
    v.push('robot footprint outside the field perimeter');
  }
  if (footprintHitsFrame(geo.releaseIn, geo.heading, k.robotLengthIn, k.robotWidthIn)) {
    v.push('robot footprint overlaps the Hive frame base');
  }
  return v;
}

/** Constraint list for the solver (optionally ignores footprint). */
export function solverConstraintViolations(cfg, k, geo = shotGeometry(cfg)) {
  const v = checkConstraints(cfg, k, geo);
  if (!k.enforceFootprintInSolver) {
    return v.filter((msg) => !msg.startsWith('robot footprint'));
  }
  return v;
}

/** Corners of the robot footprint: release point at front-centre, body behind it. */
export function footprint(releaseIn, heading, L, W) {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const lx = -hy;
  const ly = hx;
  const [x, y] = releaseIn;
  return [
    [x + lx * W / 2, y + ly * W / 2],
    [x - lx * W / 2, y - ly * W / 2],
    [x - lx * W / 2 - hx * L, y - ly * W / 2 - hy * L],
    [x + lx * W / 2 - hx * L, y + ly * W / 2 - hy * L],
  ];
}

function footprintHitsFrame(releaseIn, heading, L, W) {
  const fx = D.frameWidth / 2;
  const fy = D.frameDepth / 2;
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const a = (i / 8) * L;
      const b = (j / 8 - 0.5) * W;
      const x = releaseIn[0] - hx * a - hy * b;
      const y = releaseIn[1] - hy * a + hx * b;
      if (Math.abs(x) < fx && Math.abs(y) < fy) return true;
    }
  }
  return false;
}

/**
 * Height (m) of the ball centre when its horizontal travel along the heading
 * reaches Dh (m), in free flight. -Infinity if it hits the floor first.
 */
export function heightAtDistance(release, heading, angleDeg, exitSpeed, spinSign, aero, Dh, dt = 0.001) {
  const spinRate = spinSign === 0 ? 0 : exitSpeed / POLLEN.radius;
  const st = launchState(release, heading, angleDeg, exitSpeed, spinRate, spinSign);
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  let prevX = 0;
  let prevZ = st.p[2];
  for (let t = 0; t < 4; t += dt) {
    rk4Step(st, dt, aero);
    const x = (st.p[0] - release[0]) * hx + (st.p[1] - release[1]) * hy;
    const z = st.p[2];
    if (x >= Dh) {
      const f = (Dh - prevX) / (x - prevX);
      return prevZ + (z - prevZ) * f;
    }
    if (z < POLLEN.radius) return -Infinity;
    prevX = x;
    prevZ = z;
  }
  return -Infinity;
}

/** Exit speed that hits the target at a given angle, or null. */
export function solveSpeedForAngle(release, heading, angleDeg, spinSign, aero, Dh, H, vMax) {
  const f = (v) => heightAtDistance(release, heading, angleDeg, v, spinSign, aero, Dh) - H;
  let lo = 0.3;
  let hi = vMax;
  if (f(hi) < 0) return null;
  for (let i = 0; i < 26; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Lowest exit speed at this ramp angle for which the full simulation scores
 * (ball ends in the target Cell). Returns null if none in [vLo, vHi].
 */
export function findMinMakeExitSpeed(cfg, angleDeg, env, geo, wheel, constraints, vLo, vHi) {
  const makes = (v) => {
    const motorRpm = motorRpmForExitSpeed(v, wheel);
    const c = { ...cfg, rampAngleDeg: angleDeg, motorRpm };
    if (solverConstraintViolations(c, constraints, geo).length) return false;
    return runShot(c, { record: false }, env).result.make;
  };
  const steps = 36;
  let hiMake = null;
  for (let i = 0; i <= steps; i++) {
    const v = vLo + ((vHi - vLo) * i) / steps;
    if (makes(v)) {
      hiMake = v;
      break;
    }
  }
  if (hiMake == null) return null;
  let lo = vLo;
  let hi = hiMake;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (makes(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function launchWheel(cfg, eff) {
  return {
    gearRatio: cfg.gearRatio,
    wheelDiameterIn: cfg.wheelDiameterIn,
    efficiency: eff,
    spinMode: cfg.spinMode,
  };
}

function exitSpeedAtRpm(motorRpm, wheel) {
  return launchFromSetup({ ...wheel, motorRpm }).exitSpeed;
}

/**
 * Build search grid: { angle, motorRpm, v }[] before validation pass.
 * searchMode: default | lockRpm | lockAngle | fixed
 */
function buildSearchGrid(cfg, constraints, opts, geo, env, wheel, motor, requireSpot, aero, spinSign, Dh, H, vMax, vLo, onProgress) {
  const angleStep = opts.angleStep ?? 0.5;
  const aMin = Math.max(opts.angleMin ?? 5, constraints.minRampDeg);
  const aMax = Math.min(opts.angleMax ?? 85, constraints.maxRampDeg);
  const maxRpm = motor.freeSpeedRpm * constraints.maxRpmFraction;
  const rpmStep = Math.max(5, opts.rpmStep ?? 25);
  const lockRpm = !!constraints.lockMotorRpm;
  const lockAngle = !!constraints.lockRampAngle;

  if (lockRpm && lockAngle) {
    onProgress?.(0.5);
    const motorRpm = cfg.motorRpm;
    const v = exitSpeedAtRpm(motorRpm, wheel);
    return {
      searchMode: 'fixed',
      raw: [{ angle: cfg.rampAngleDeg, motorRpm, v }],
    };
  }

  if (lockRpm) {
    const motorRpm = cfg.motorRpm;
    const v = exitSpeedAtRpm(motorRpm, wheel);
    const nAngles = Math.floor((aMax - aMin) / angleStep + 1e-9) + 1;
    const raw = [];
    for (let i = 0; i < nAngles; i++) {
      const angle = +(aMin + i * angleStep).toFixed(4);
      raw.push({ angle, motorRpm, v });
      onProgress?.(0.5 * ((i + 1) / nAngles));
    }
    return { searchMode: 'lockRpm', raw };
  }

  if (lockAngle) {
    const angle = cfg.rampAngleDeg;
    const raw = [];
    const steps = Math.max(1, Math.ceil(maxRpm / rpmStep));
    for (let i = 0; i <= steps; i++) {
      const motorRpm = Math.min(maxRpm, i * rpmStep);
      raw.push({ angle, motorRpm, v: exitSpeedAtRpm(motorRpm, wheel) });
      onProgress?.(0.5 * ((i + 1) / (steps + 1)));
    }
    return { searchMode: 'lockAngle', raw };
  }

  const raw = [];
  const nAngles = Math.floor((aMax - aMin) / angleStep + 1e-9) + 1;
  for (let i = 0; i < nAngles; i++) {
    const angle = +(aMin + i * angleStep).toFixed(4);
    const v = requireSpot
      ? solveSpeedForAngle(geo.release, geo.heading, angle, spinSign, aero, Dh, H, vMax)
      : findMinMakeExitSpeed(cfg, angle, env, geo, wheel, constraints, vLo, vMax);
    if (v != null) {
      raw.push({ angle, motorRpm: motorRpmForExitSpeed(v, wheel), v });
    }
    onProgress?.(0.5 * ((i + 1) / nAngles));
  }
  return { searchMode: 'default', raw };
}

/**
 * Full reverse solve.
 * @param cfg base config (landing spot, distance, release height, wheel, gear, eff, spin, aero, motor)
 * @param constraints see defaultConstraints()
 * @param opts { angleStep, angleMin, angleMax, rpmStep, criterion, onProgress, validate }
 */
export function solve(cfg, constraints = defaultConstraints(), opts = {}) {
  const criterion = opts.criterion ?? 'rpm';
  const aero = cfg.aero ?? DEFAULT_AERO;
  const geo = shotGeometry(cfg);
  const motor = motorById(cfg.motorId);
  const eff = cfg.efficiencyPct / 100;
  const wheel = launchWheel(cfg, eff);
  const vMax = launchFromSetup({ ...wheel, motorRpm: motor.freeSpeedRpm * 1.5 }).exitSpeed;
  const spinSign = cfg.spinMode === 'backspin' ? 1 : cfg.spinMode === 'topspin' ? -1 : 0;
  const Dh = Math.hypot(geo.target[0] - geo.release[0], geo.target[1] - geo.release[1]);
  const H = geo.target[2];
  const env = buildEnvironment(geo.hiveState, cfg.restingBalls ?? []);
  const requireSpot = constraints.requireExactLanding === true;
  const vLo = 0.3;

  const { searchMode, raw } = buildSearchGrid(
    cfg, constraints, opts, geo, env, wheel, motor, requireSpot, aero, spinSign, Dh, H, vMax, vLo, opts.onProgress,
  );
  if (!raw.length) {
    return {
      candidates: [],
      best: { low: null, high: null },
      ranked: [],
      minSpeedAngle: null,
      minSpeedRpm: null,
      searchMode,
      target: geo.targetIn,
      criterion,
    };
  }
  const minIdx = raw.reduce((bi, c, i) => (c.v < raw[bi].v ? i : bi), 0);
  const minSpeedAngle = searchMode === 'lockAngle' ? null : raw[minIdx].angle;
  const minSpeedRpm = searchMode === 'lockAngle' ? raw[minIdx].motorRpm : null;

  const candidates = [];
  for (let i = 0; i < raw.length; i++) {
    const { angle, v, motorRpm } = raw[i];
    const c = { ...cfg, rampAngleDeg: angle, motorRpm };
    const violations = solverConstraintViolations(c, constraints, geo);
    const cand = {
      rampAngleDeg: angle,
      exitSpeed: v,
      motorRpm,
      wheelRpm: motorRpm / cfg.gearRatio,
      branch:
        searchMode === 'lockAngle'
          ? motorRpm < minSpeedRpm
            ? 'low'
            : motorRpm > minSpeedRpm
              ? 'high'
              : 'min'
          : angle < minSpeedAngle
            ? 'low'
            : angle > minSpeedAngle
              ? 'high'
              : 'min',
      violations,
    };
    if (opts.validate !== false && violations.length === 0) Object.assign(cand, validate(c, env, geo, constraints));
    else if (opts.validate !== false) Object.assign(cand, validate(c, env, geo, constraints, false));
    const spotOk = requireSpot ? !!cand.hitsTarget : true;
    cand.valid = violations.length === 0 && !!cand.make && spotOk;
    candidates.push(cand);
    opts.onProgress?.(0.5 + 0.5 * ((i + 1) / raw.length));
  }

  return {
    candidates,
    ...rankCandidates(candidates, criterion),
    minSpeedAngle,
    minSpeedRpm,
    searchMode,
    target: geo.targetIn,
    release: geo.releaseIn,
  };
}

/** Rank valid candidates by a criterion; best per arc family. Pure, cheap. */
export function rankCandidates(candidates, criterion = 'rpm') {
  const crit = CRITERIA[criterion] ?? CRITERIA.rpm;
  const score = (c) => {
    const val = c[crit.key];
    return Number.isFinite(val) ? crit.dir * val : Infinity;
  };
  const ranked = candidates.filter((c) => c.valid).sort((a, b) => score(a) - score(b));
  const bestOf = (br) => ranked.find((c) => c.branch === br || (c.branch === 'min' && br === 'low')) ?? null;
  return { ranked, best: { low: bestOf('low'), high: bestOf('high') }, criterion };
}

/** Forward-validate a candidate with full collisions; compute ranking metrics. */
function validate(c, env, geo, constraints, withRobustness = true) {
  const sim = runShot(c, { record: false }, env);
  const fc = sim.stats.firstContact;
  const errIn = fc ? Math.sqrt(sq(fc.p[0] - geo.target[0]) + sq(fc.p[1] - geo.target[1]) + sq(fc.p[2] - geo.target[2])) / IN : Infinity;
  const out = {
    make: sim.result.make,
    reason: sim.result.reason,
    hitsTarget: errIn < 1.0,
    firstContactErrIn: errIn,
    apexIn: sim.stats.apexZ / IN,
    flightTime: sim.stats.flightTime,
    entryDescentDeg: sim.stats.entry ? sim.stats.entry.descentDeg : NaN,
    clearanceIn: sim.stats.entry ? sim.stats.entry.clearanceIn : NaN,
    sensitivityIn: NaN,
  };
  if (withRobustness && out.make) {
    const stillMake = [0.98, 1.02].map((f) =>
      runShot({ ...c, motorRpm: c.motorRpm * f }, { record: false }, env).result.make,
    );
    // 0 = both RPM tweaks still score, 1 = one fails, 2 = both fail (inches scale for ranking)
    const fails = stillMake.filter((m) => !m).length;
    out.sensitivityIn = fails === 0 ? 0 : fails === 1 ? 2 : 8;
    if (constraints.requireExactLanding && out.hitsTarget && fc) {
      const pts = [0.98, 1.02].map((f) => {
        const r = runShot({ ...c, motorRpm: c.motorRpm * f }, { record: false, stopAtFirstContact: true }, env);
        return r.stats.firstContact ? r.stats.firstContact.p : null;
      });
      if (pts[0] && pts[1]) {
        out.sensitivityIn = Math.max(...pts.map((p) => Math.hypot(p[0] - fc.p[0], p[1] - fc.p[1], p[2] - fc.p[2]))) / IN / 2;
      }
    }
  }
  return out;
}
