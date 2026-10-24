// Shot simulation: launch -> free flight (RK4) -> contacts with the Hive ->
// settle. Pure functions; inputs and outputs are plain objects so the module
// runs unchanged in the browser, in a Web Worker and in Node tests.

import { POLLEN } from './ball.js';
import { rk4Step, DEFAULT_AERO } from './integrator.js';
import { resolveCollider, inAabb } from './collisions.js';
import { launchFromSetup, launchState } from './launcher.js';
import { D, IN } from '../field/dimensions.js';
import {
  HIVES, CELLS, cellFrame, worldToCell, insideCell, buildColliders, openingLipWorld,
  outwardHorizontal, floorTargetWorld, polygonClearance, pointInPolygon2,
} from '../field/geometry.js';

export const DEFAULT_SIM = Object.freeze({
  dt: 0.0005, // s
  tMax: 6, // s
  recordEvery: 4, // steps between recorded trajectory points
  restSpeed: 0.03, // m/s
  restTime: 0.25, // s
  rollingResistance: 0.02, // dimensionless, applied while in contact
  stopAtFirstContact: false,
  record: true,
});

/** Default user-facing configuration (inches / degrees / percent). */
export function defaultConfig() {
  return {
    target: { hive: 'blue', cell: 'scoring' },
    otherHiveUp: null, // null = match-start state for the non-target Hive
    landing: { u: 0, s: 15.5 },
    distanceIn: 30,
    lateralIn: 0,
    releaseHeightIn: 16,
    motorId: '5203-2402-0001',
    motorRpm: 2400,
    gearRatio: 1,
    wheelDiameterIn: 4,
    efficiencyPct: 80,
    rampAngleDeg: 70,
    spinMode: 'topspin',
    aero: { ...DEFAULT_AERO },
    stagedNectar: false,
  };
}

/** Hive state implied by a config: the target cell is always the upward one. */
export function hiveStateFor(cfg) {
  const state = { red: 'audience', blue: 'scoring' };
  if (cfg.otherHiveUp) {
    for (const h of HIVES) if (h !== cfg.target.hive) state[h] = cfg.otherHiveUp;
  }
  state[cfg.target.hive] = cfg.target.cell;
  return state;
}

export function allFrames(hiveState) {
  const out = [];
  for (const h of HIVES) for (const c of CELLS) out.push(cellFrame(h, c, hiveState[h]));
  return out;
}

/**
 * Geometry of a shot: release point, heading toward the landing target.
 * distanceIn is the horizontal distance from the release point to the bottom
 * lip (bottom-centre) of the target cell opening, measured along the cell's
 * outward horizontal direction.
 */
export function shotGeometry(cfg) {
  const hiveState = hiveStateFor(cfg);
  const frame = cellFrame(cfg.target.hive, cfg.target.cell, hiveState[cfg.target.hive]);
  const lip = openingLipWorld(frame);
  const out = outwardHorizontal(frame);
  const releaseIn = [
    lip[0] + out[0] * cfg.distanceIn + cfg.lateralIn,
    lip[1] + out[1] * cfg.distanceIn,
    cfg.releaseHeightIn,
  ];
  const targetIn = floorTargetWorld(frame, cfg.landing.u, cfg.landing.s, POLLEN.radiusIn);
  const heading = Math.atan2(targetIn[1] - releaseIn[1], targetIn[0] - releaseIn[0]);
  return { hiveState, frame, releaseIn, targetIn, heading, release: scale(releaseIn, IN), target: scale(targetIn, IN) };
}

function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Build the environment (colliders, frames) once per Hive state. */
export function buildEnvironment(hiveState, restingBalls = []) {
  return {
    hiveState,
    groups: buildColliders(hiveState),
    frames: allFrames(hiveState),
    resting: restingBalls.map((b) => ({ kind: 'sphere', c: b.c, r: b.r, e: D.restitutionBall, mu: D.frictionBall, tag: 'ball' })),
  };
}

/** Full forward shot from a user config. */
export function runShot(cfg, opts = {}, env = null) {
  const geo = shotGeometry(cfg);
  const launch = launchFromSetup({
    motorRpm: cfg.motorRpm,
    gearRatio: cfg.gearRatio,
    wheelDiameterIn: cfg.wheelDiameterIn,
    efficiency: cfg.efficiencyPct / 100,
    spinMode: cfg.spinMode,
  });
  const init = launchState(geo.release, geo.heading, cfg.rampAngleDeg, launch.exitSpeed, launch.spinRate, launch.spinSign);
  const environment = env ?? buildEnvironment(geo.hiveState, cfg.restingBalls ?? []);
  const sim = simulate(init, { ...environment, aero: cfg.aero ?? DEFAULT_AERO, targetFrame: geo.frame }, opts);
  return { ...sim, launch, geometry: geo };
}

/**
 * Core integrator loop.
 * env = { aero, groups, resting, frames, targetFrame }
 */
export function simulate(init, env, options = {}) {
  const o = { ...DEFAULT_SIM, ...options };
  const ball = POLLEN;
  const r = ball.radius;
  const state = { p: [...init.p], v: [...init.v], w: [...init.w] };
  const tf = env.targetFrame;
  const points = o.record ? [[...state.p]] : null;
  const times = o.record ? [0] : null;
  const events = [];
  const fieldHalf = (D.fieldHalf + 2) * IN;
  let apexZ = state.p[2];
  let firstContact = null;
  let entry = null;
  let restClock = 0;
  let t = 0;
  let step = 0;
  let reason = 'timeout';
  let prevS = tf ? worldToCell(tf, scale(state.p, 1 / IN)).s : 0;
  const exitSpeed = Math.hypot(...state.v);

  while (t < o.tMax) {
    rk4Step(state, o.dt, env.aero);
    t += o.dt;
    step++;

    // Opening-plane crossing of the target cell (first time only).
    if (tf && !entry) {
      const pIn = scale(state.p, 1 / IN);
      const loc = worldToCell(tf, pIn);
      if (prevS > tf.sOpen && loc.s <= tf.sOpen) {
        const inside = pointInPolygon2(tf.polygon, loc.u, loc.v, 0);
        const vh = Math.hypot(state.v[0], state.v[1]);
        entry = {
          t,
          p: [...state.p],
          inside,
          clearanceIn: polygonClearance(tf.polygon, loc.u, loc.v) - ball.radius / IN,
          descentDeg: (Math.atan2(-state.v[2], vh) * 180) / Math.PI,
          speed: Math.hypot(...state.v),
        };
        events.push({ type: 'enter', t, p: [...state.p], inside });
      }
      prevS = loc.s;
    }

    // Floor (tile top): any floor contact is a miss.
    if (state.p[2] <= r) {
      state.p[2] = r;
      events.push({ type: 'floor', t, p: [...state.p] });
      if (!firstContact) firstContact = { t, p: [...state.p], tag: 'floor' };
      reason = 'floor';
      break;
    }
    if (Math.abs(state.p[0]) > fieldHalf || Math.abs(state.p[1]) > fieldHalf) {
      reason = 'out';
      break;
    }

    // Contacts
    let touching = false;
    for (const g of env.groups) {
      if (!inAabb(state.p, g.aabb, r)) continue;
      for (const c of g.items) {
        const hit = resolveCollider(state, c, ball);
        if (hit) {
          touching = true;
          if (!hit.resting || !firstContact) {
            events.push({ type: 'contact', t, p: [...state.p], tag: hit.tag, vn: hit.vn });
          }
          if (!firstContact) firstContact = { t, p: [...state.p], tag: hit.tag };
        }
      }
    }
    for (const c of env.resting ?? []) {
      const hit = resolveCollider(state, c, ball);
      if (hit) {
        touching = true;
        if (!hit.resting) events.push({ type: 'contact', t, p: [...state.p], tag: 'ball', vn: hit.vn });
        if (!firstContact) firstContact = { t, p: [...state.p], tag: 'ball' };
      }
    }

    if (!firstContact) apexZ = Math.max(apexZ, state.p[2]);

    if (o.record && (step % o.recordEvery === 0 || touching)) {
      points.push([...state.p]);
      times.push(t);
    }

    if (o.stopAtFirstContact && firstContact) {
      reason = 'firstContact';
      break;
    }

    if (touching) {
      // Rolling resistance while in contact (crude, isotropic).
      const sp = Math.hypot(...state.v);
      if (sp > 0) {
        const dv = Math.min(sp, o.rollingResistance * env.aero.g * o.dt);
        for (let i = 0; i < 3; i++) state.v[i] -= (state.v[i] / sp) * dv;
      }
      const wm = Math.hypot(...state.w);
      if (wm > 0) {
        const dw = Math.min(wm, (o.rollingResistance * env.aero.g * o.dt) / r);
        for (let i = 0; i < 3; i++) state.w[i] -= (state.w[i] / wm) * dw;
      }
      if (sp < o.restSpeed) {
        restClock += o.dt;
        if (restClock >= o.restTime) {
          reason = 'rest';
          break;
        }
      } else restClock = 0;
    } else restClock = 0;
  }

  if (o.record) {
    points.push([...state.p]);
    times.push(t);
  }

  const finalIn = scale(state.p, 1 / IN);
  let endCell = null;
  for (const f of env.frames ?? []) {
    if (insideCell(f, finalIn, 0)) {
      endCell = f.id;
      break;
    }
  }
  const make = !!tf && endCell === tf.id && reason !== 'floor' && reason !== 'out';
  const firstEventT = Math.min(entry && entry.inside ? entry.t : Infinity, firstContact ? firstContact.t : Infinity);

  return {
    points,
    times,
    events,
    final: { p: [...state.p], v: [...state.v], t, reason, endCell },
    result: {
      make,
      reason: make ? 'in cell' : describeMiss(reason, endCell, entry, firstContact),
    },
    stats: {
      exitSpeed,
      flightTime: Number.isFinite(firstEventT) ? firstEventT : t,
      apexZ,
      entry,
      firstContact,
    },
  };
}

function describeMiss(reason, endCell, entry, firstContact) {
  if (endCell) return `ended in wrong cell (${endCell})`;
  if (reason === 'floor') {
    if (entry && entry.inside) return 'entered, bounced out, hit the floor';
    if (firstContact && firstContact.tag !== 'floor') return `hit ${describeTag(firstContact.tag)}, fell to the floor`;
    return 'landed on the floor';
  }
  if (reason === 'out') return 'left the field';
  if (reason === 'rest') return 'came to rest outside the cell';
  if (reason === 'firstContact') return 'stopped at first contact';
  return 'did not finish inside the cell';
}

/** Human-readable name for a collider tag such as 'blue-scoring:rim3'. */
export function describeTag(tag) {
  const [owner, part = ''] = tag.split(':');
  if (owner === 'frame') return 'the Hive frame';
  if (owner === 'ball') return 'a resting ball';
  const name = part === 'wall0' ? 'floor (underside if from outside)'
    : part.startsWith('wall') ? 'skin wall'
    : part.startsWith('rim') ? 'rim'
    : part.startsWith('ribOuter') ? 'outer rib'
    : part === 'back' ? 'back skin' : part;
  return `${owner} cell ${name}`;
}
