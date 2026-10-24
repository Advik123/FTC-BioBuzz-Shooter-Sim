import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POLLEN } from '../src/physics/ball.js';
import { DEFAULT_AERO, rk4Step, liftCoefficient } from '../src/physics/integrator.js';
import { launchFromSetup, launchState, motorRpmForExitSpeed } from '../src/physics/launcher.js';
import { resolveCollider } from '../src/physics/collisions.js';
import { simulate, runShot, defaultConfig, shotGeometry } from '../src/physics/simulate.js';
import { solve, defaultConstraints, checkConstraints } from '../src/physics/solver.js';
import { MOTORS, motorById } from '../src/physics/motors.js';
import { D, IN, SPEC } from '../src/field/dimensions.js';
import {
  cellFrame, openingLipWorld, floorTargetWorld, insideCell, buildColliders, defaultHiveState,
} from '../src/field/geometry.js';

const VACUUM = { ...DEFAULT_AERO, drag: false, magnus: false };
const r = POLLEN.radius;

/** Free-space environment: no Hive, only the tile floor (built into simulate). */
const open = (aero, extra = {}) => ({ aero, groups: [], resting: [], frames: [], targetFrame: null, ...extra });

function launch(angleDeg, speed, spinSign = 0, z0 = r) {
  return launchState([0, 0, z0], 0, angleDeg, speed, spinSign ? speed / r : 0, spinSign);
}

test('ball spec matches the manual (2.8 in, 0.055 lb)', () => {
  assert.equal(POLLEN.diameterIn, 2.8);
  assert.ok(Math.abs(POLLEN.mass - 0.055 * 0.45359237) < 1e-9);
  assert.ok(Math.abs(POLLEN.radius - 1.4 * IN) < 1e-12);
});

test('vacuum range matches the closed form', () => {
  const g = VACUUM.g;
  for (const [deg, v] of [[30, 3], [45, 3.5], [60, 3]]) {
    const sim = simulate(launch(deg, v), open(VACUUM), { record: false });
    const th = (deg * Math.PI) / 180;
    const expected = (v * v * Math.sin(2 * th)) / g;
    assert.equal(sim.final.reason, 'floor');
    assert.ok(Math.abs(sim.final.p[0] - expected) < 0.005, `${deg} deg: ${sim.final.p[0]} vs ${expected}`);
    const apex = r + (v * Math.sin(th)) ** 2 / (2 * g);
    assert.ok(Math.abs(sim.stats.apexZ - apex) < 0.002);
  }
});

test('RK4 free flight matches analytic position', () => {
  const s = launch(50, 8, 0, 1);
  const v0 = [...s.v];
  const dt = 0.0005;
  let t = 0;
  for (let i = 0; i < 600; i++) {
    rk4Step(s, dt, VACUUM);
    t += dt;
  }
  assert.ok(Math.abs(s.p[0] - v0[0] * t) < 1e-9);
  assert.ok(Math.abs(s.p[2] - (1 + v0[2] * t - 0.5 * VACUUM.g * t * t)) < 1e-9);
});

test('drag shortens range and lowers apex', () => {
  const vac = simulate(launch(45, 3.5), open(VACUUM), { record: false });
  const air = simulate(launch(45, 3.5), open({ ...DEFAULT_AERO, magnus: false }), { record: false });
  assert.ok(air.final.p[0] < vac.final.p[0]);
  assert.ok(air.stats.apexZ < vac.stats.apexZ);
});

test('backspin raises the apex, topspin lowers it (Magnus)', () => {
  const aero = DEFAULT_AERO;
  const none = simulate(launch(45, 4, 0), open(aero), { record: false });
  const back = simulate(launch(45, 4, +1), open(aero), { record: false });
  const top = simulate(launch(45, 4, -1), open(aero), { record: false });
  assert.ok(back.stats.apexZ > none.stats.apexZ + 0.005, 'backspin should lift');
  assert.ok(top.stats.apexZ < none.stats.apexZ - 0.005, 'topspin should push down');
  assert.ok(back.final.p[0] > none.final.p[0] && top.final.p[0] < none.final.p[0]);
});

test('lift coefficient saturates at clMax', () => {
  assert.equal(liftCoefficient(0, DEFAULT_AERO), 0);
  assert.ok(Math.abs(liftCoefficient(0.1, DEFAULT_AERO) - 0.06) < 1e-12);
  assert.equal(liftCoefficient(10, DEFAULT_AERO), DEFAULT_AERO.clMax);
});

test('launcher: exit speed is half the efficient surface speed, and inverts', () => {
  const L = launchFromSetup({ motorRpm: 3000, gearRatio: 1, wheelDiameterIn: 4, efficiency: 0.8, spinMode: 'topspin' });
  const surface = (3000 / 60) * Math.PI * 4 * IN;
  assert.ok(Math.abs(L.surfaceSpeed - surface) < 1e-9);
  assert.ok(Math.abs(L.exitSpeed - 0.4 * surface) < 1e-9);
  assert.ok(Math.abs(L.spinRate - L.exitSpeed / r) < 1e-9);
  assert.equal(L.spinSign, -1);
  const back = motorRpmForExitSpeed(L.exitSpeed, { gearRatio: 1, wheelDiameterIn: 4, efficiency: 0.8 });
  assert.ok(Math.abs(back - 3000) < 1e-6);
  // gear ratio 2 (motor turns twice per wheel turn) halves wheel speed
  assert.ok(Math.abs(launchFromSetup({ motorRpm: 3000, gearRatio: 2, wheelDiameterIn: 4, efficiency: 0.8 }).wheelRpm - 1500) < 1e-9);
});

test('goBILDA motor table has the published free speeds', () => {
  assert.deepEqual(MOTORS.map((m) => m.freeSpeedRpm), [6000, 1620, 1150]);
  assert.equal(motorById('nope').id, MOTORS[0].id);
});

// --- Collisions ------------------------------------------------------------------

const plate = (z, e, mu = 0, half = 1) => ({
  kind: 'poly',
  pts: [[-half, -half, z], [half, -half, z], [half, half, z], [-half, half, z]],
  normal: [0, 0, 1],
  e,
  mu,
  tag: 'plate',
});
const group = (items) => ({ id: 'g', aabb: [[-5, -5, -5], [5, 5, 5]], items });

test('normal impact: rebound speed = e * impact speed', () => {
  const st = { p: [0, 0, 0.5 + r * 0.9], v: [0, 0, -3], w: [0, 0, 0] };
  const hit = resolveCollider(st, plate(0.5, 0.5));
  assert.ok(hit);
  assert.ok(Math.abs(st.v[2] - 1.5) < 1e-9);
  assert.ok(st.p[2] >= 0.5 + r - 1e-12, 'positional correction pushes the ball out');
});

test('friction converts sliding into spin without creating energy', () => {
  const st = { p: [0, 0, 0.5 + r * 0.95], v: [2, 0, -2], w: [0, 0, 0] };
  const m = POLLEN.mass;
  const I = POLLEN.inertiaK * m * r * r;
  const before = 0.5 * m * (st.v[0] ** 2 + st.v[2] ** 2);
  resolveCollider(st, plate(0.5, 0.5, 0.4));
  const after = 0.5 * m * (st.v[0] ** 2 + st.v[1] ** 2 + st.v[2] ** 2) + 0.5 * I * (st.w[0] ** 2 + st.w[1] ** 2 + st.w[2] ** 2);
  assert.ok(st.v[0] < 2 && st.v[0] > 0, 'tangential speed reduced');
  assert.ok(st.w[1] > 0, 'ball spins forward (about +y when moving +x on a floor)');
  assert.ok(after < before);
});

test('energy is conserved with e = 1, mu = 0, no air', () => {
  const env = open(VACUUM, { groups: [group([plate(0.5, 1)])] });
  const z0 = 1.2;
  const sim = simulate({ p: [0, 0, z0], v: [0.2, 0, 0], w: [0, 0, 0] }, env, { tMax: 1.2, recordEvery: 1 });
  const contact = sim.events.find((e) => e.type === 'contact');
  assert.ok(contact, 'ball should hit the plate');
  const afterIdx = sim.times.findIndex((t) => t > contact.t + 0.01);
  const reboundApex = Math.max(...sim.points.slice(afterIdx).map((p) => p[2]));
  assert.ok(Math.abs(reboundApex - z0) < 0.005, `rebound apex ${reboundApex} vs ${z0}`);
});

test('a fast ball does not tunnel through a thin plate', () => {
  const env = open(VACUUM, { groups: [group([plate(0.5, 0.5, 0.3)])] });
  const sim = simulate({ p: [0, 0, 1.0], v: [0, 0, -25], w: [0, 0, 0] }, env, { tMax: 0.1 });
  assert.ok(sim.points.every((p) => p[2] > 0.5), 'ball stayed above the plate');
});

test('ball rests on a horizontal plate', () => {
  const env = open(DEFAULT_AERO, { groups: [group([plate(0.5, 0.5, 0.3)])] });
  const sim = simulate({ p: [0, 0, 0.7], v: [0.1, 0, 0], w: [0, 0, 0] }, env, { tMax: 4 });
  assert.equal(sim.final.reason, 'rest');
  assert.ok(Math.abs(sim.final.p[2] - (0.5 + r)) < 0.002);
});

// --- Field geometry ----------------------------------------------------------------

test('upward cell opening lip is ~53.5 in high (Field Setup checklist 53.5 +/- 0.5)', () => {
  for (const hive of ['red', 'blue']) {
    for (const cell of ['audience', 'scoring']) {
      const f = cellFrame(hive, cell, cell);
      const lip = openingLipWorld(f);
      assert.ok(Math.abs(lip[2] - D.cellLipCheck) <= 0.5, `${hive}-${cell} lip ${lip[2]}`);
      assert.ok(Math.abs(Math.abs(lip[0]) - D.hiveCenterX) < 1e-9);
    }
  }
});

test('floor target sits inside the cell with ball clearance', () => {
  const f = cellFrame('blue', 'scoring', 'scoring');
  const p = floorTargetWorld(f, 0, 15.5, POLLEN.radiusIn);
  assert.ok(insideCell(f, p, 0));
  const floorZ = p[2];
  assert.ok(floorZ > 45 && floorZ < 56);
});

test('collider set: 4 cells x 22 parts + frame', () => {
  const groups = buildColliders(defaultHiveState());
  const cells = groups.filter((g) => g.id !== 'frame');
  assert.equal(cells.length, 4);
  for (const g of cells) assert.equal(g.items.length, 7 * 3 + 1);
  assert.ok(groups.find((g) => g.id === 'frame').items.length >= 5);
});

test('every dimension is source-tagged', () => {
  for (const [k, v] of Object.entries(SPEC)) {
    assert.ok(['manual', 'checklist', 'guide', 'cad', 'placeholder', 'derived'].includes(v.source), `${k}: ${v.source}`);
  }
});

// --- Forward shot and reverse solver ----------------------------------------------

test('default forward shot scores', () => {
  const sim = runShot(defaultConfig());
  assert.equal(sim.result.make, true, sim.result.reason);
  assert.equal(sim.final.endCell, 'blue-scoring');
});

test('shot that falls short is a floor miss', () => {
  const sim = runShot({ ...defaultConfig(), motorRpm: 1200 });
  assert.equal(sim.result.make, false);
  assert.ok(sim.events.some((e) => e.type === 'floor'));
});

test('default robot position satisfies the constraints', () => {
  const cfg = defaultConfig();
  assert.deepEqual(checkConstraints(cfg, defaultConstraints(), shotGeometry(cfg)), []);
  const tall = { ...cfg, releaseHeightIn: 40 };
  assert.ok(checkConstraints(tall, defaultConstraints(), shotGeometry(tall)).length > 0);
});

test('reverse solver with locked motor RPM only varies ramp angle', () => {
  const cfg = defaultConfig();
  const res = solve(
    { ...cfg, motorRpm: 2400 },
    { ...defaultConstraints(), lockMotorRpm: true, lockRampAngle: false },
    { angleStep: 2 },
  );
  assert.equal(res.searchMode, 'lockRpm');
  assert.ok(res.candidates.length > 5);
  assert.ok(res.candidates.every((c) => Math.abs(c.motorRpm - 2400) < 1e-6));
  assert.ok(new Set(res.candidates.map((c) => c.rampAngleDeg)).size > 1);
});

test('reverse solver round trip: loaded solution lands on the chosen spot', () => {
  const cfg = defaultConfig();
  const res = solve(cfg, defaultConstraints(), { angleStep: 1 });
  assert.ok(res.ranked.length > 0, 'at least one valid solution');
  const best = res.best.high ?? res.best.low;
  const sim = runShot({ ...cfg, rampAngleDeg: best.rampAngleDeg, motorRpm: best.motorRpm });
  assert.equal(sim.result.make, true);
  assert.equal(best.make, true);
  // ranking by RPM: ascending
  for (let i = 1; i < res.ranked.length; i++) assert.ok(res.ranked[i].motorRpm >= res.ranked[i - 1].motorRpm);
  // min-speed angle splits the branches
  for (const c of res.candidates) {
    if (c.branch === 'low') assert.ok(c.rampAngleDeg < res.minSpeedAngle);
    if (c.branch === 'high') assert.ok(c.rampAngleDeg > res.minSpeedAngle);
  }
});
