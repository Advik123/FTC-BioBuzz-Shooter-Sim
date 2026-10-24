// Wiring only: state, persistence, and passing data between the pure physics
// modules (src/physics, src/field) and the Three.js / DOM views (src/render).
import { createScene } from './render/scene.js';
import { buildTiles } from './render/tiles.js';
import { buildPerimeter, buildTape, buildFlowers } from './render/field.js';
import { buildHive } from './render/hive.js';
import { TrajectoryView } from './render/trajectory.js';
import { ShooterView, MarkersView } from './render/shooter.js';
import {
  bindInputs, fillSelect, setReadout, TargetPicker, renderSolverResults, drawSolvePlot, renderSources, fmtSpeed,
} from './render/ui.js';
import { defaultConfig, runShot, shotGeometry, hiveStateFor } from './physics/simulate.js';
import { solve, defaultConstraints, checkConstraints, rankCandidates, CRITERIA } from './physics/solver.js';
import { MOTORS, motorById } from './physics/motors.js';
import { SPIN_MODES, launchFromSetup } from './physics/launcher.js';
import { POLLEN, NECTAR_RADIUS } from './physics/ball.js';
import { D, IN, SOURCES, specTable } from './field/dimensions.js';
import { HIVES, cellFrame, cellId, floorTargetRange, stagedNectarCentres, cellFloorV } from './field/geometry.js';

const STORE = 'biobuzz-launcher-sim-v1';

const defaults = () => ({
  cfg: defaultConfig(),
  constraints: defaultConstraints(),
  ui: { showPreview: true, timeScale: 1, units: 'imperial', criterion: 'rpm', angleStep: 0.5, rpmStep: 25, maxRpmPct: 100 },
});

function load() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s) return d;
    return {
      cfg: {
        ...d.cfg,
        ...s.cfg,
        target: { ...d.cfg.target, ...s.cfg?.target },
        landing: { ...d.cfg.landing, ...s.cfg?.landing },
        aero: { ...d.cfg.aero, ...s.cfg?.aero },
      },
      constraints: { ...d.constraints, ...s.constraints },
      ui: { ...d.ui, ...s.ui },
    };
  } catch {
    return d;
  }
}

const state = load();
let resting = []; // POLLEN that ended in a cell: { cellId, c:[m], r, kind }
let lastFired = null;
let lastSolve = null;
let lastSolveKey = '';
let lastPreviewSim = null;

// --- Scene -------------------------------------------------------------------
const viewport = document.getElementById('viewport');
const view = createScene(viewport);
view.fieldRoot.add(buildTiles(), buildPerimeter(), buildTape(), buildFlowers());
const traj = new TrajectoryView(view.fieldRoot, view.renderer);
const shooter = new ShooterView(view.fieldRoot);
const markers = new MarkersView(view.fieldRoot);
view.onTick((dt) => traj.tick(dt));
let hiveMesh = null;
let hiveKey = '';

// --- Static UI content ---------------------------------------------------------
fillSelect(document.getElementById('motor'), MOTORS.map((m) => [m.id, `${m.name}`]));
fillSelect(document.getElementById('spin'), Object.entries(SPIN_MODES));
fillSelect(document.getElementById('criterion'), Object.entries(CRITERIA).map(([k, v]) => [k, v.label]));
document.getElementById('ball-spec').innerHTML =
  `POLLEN: ${D.pollenDiameter} in. (7.1 cm) diameter, ${D.pollenMassLb} lb (${(POLLEN.mass * 1000).toFixed(1)} g). ` +
  `Modelled as a thin hollow shell (I = 2/3 m r^2). Size and mass are fixed by the game manual and cannot be edited.`;
renderSources(document.getElementById('sources'), specTable(), SOURCES);

const picker = new TargetPicker(document.getElementById('target-picker'), (u, s) => {
  state.cfg.landing = { u, s };
  refreshInputs();
  update('cfg.landing');
});

const refreshInputs = bindInputs(document.getElementById('app'), state, (path) => update(path));

// --- Helpers -----------------------------------------------------------------
function syncHive() {
  const hs = hiveStateFor(state.cfg);
  const key = JSON.stringify(hs);
  if (key !== hiveKey) {
    if (hiveMesh) view.fieldRoot.remove(hiveMesh);
    hiveMesh = buildHive(hs);
    view.fieldRoot.add(hiveMesh);
    // A cell that is no longer upward-facing would have tipped its contents out.
    const up = HIVES.map((h) => cellId(h, hs[h]));
    resting = resting.filter((b) => up.includes(b.cellId));
    hiveKey = key;
  }
  return hs;
}

function restingBalls(hs) {
  const out = resting.map((b) => ({ ...b }));
  if (state.cfg.stagedNectar) {
    for (const h of HIVES) {
      const f = cellFrame(h, hs[h], hs[h]);
      for (const c of stagedNectarCentres(f)) out.push({ cellId: f.id, c: c.map((x) => x * IN), r: NECTAR_RADIUS, kind: 'nectar', color: h });
    }
  }
  return out;
}

const simConfig = (hs) => ({ ...state.cfg, restingBalls: restingBalls(hs) });

function solveKey() {
  const { rampAngleDeg, motorRpm, ...rest } = state.cfg;
  const hs = hiveStateFor(state.cfg);
  const targetId = cellId(state.cfg.target.hive, hs[state.cfg.target.hive]);
  const inCell = resting.filter((b) => b.cellId === targetId).length;
  return JSON.stringify([rest, state.constraints, resting.length, inCell, state.cfg.stagedNectar]);
}

/** Run forward sim with current UI state (same path as Fire and the solver validate step). */
function previewSim() {
  const hs = syncHive();
  return runShot(simConfig(hs));
}

/** Update dashed trajectory + HUD from a sim result. */
function applyPreviewSim(sim) {
  if (state.ui.showPreview) traj.setPreview(sim);
  else traj.setPreview(null);
  // Live preview readout always matches current sliders (not the last animated shot).
  if (state.ui.showPreview) setReadout(sim, state.ui.units, { preview: true });
  else if (lastFired) setReadout(lastFired, state.ui.units, { preview: false });
  else setReadout(sim, state.ui.units, { preview: false });
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

// --- Update loop -----------------------------------------------------------------
let previewQueued = false;

function update(path = '') {
  const cfg = state.cfg;
  const motor = motorById(cfg.motorId);
  const rpmRange = document.getElementById('rpm-range');
  rpmRange.max = String(motor.freeSpeedRpm);
  if (cfg.motorRpm > motor.freeSpeedRpm) cfg.motorRpm = motor.freeSpeedRpm;
  if (cfg.motorRpm < 0) cfg.motorRpm = 0;
  cfg.efficiencyPct = Math.min(100, Math.max(1, cfg.efficiencyPct));
  cfg.gearRatio = Math.max(0.05, cfg.gearRatio);
  cfg.wheelDiameterIn = Math.max(0.5, cfg.wheelDiameterIn);
  cfg.releaseHeightIn = Math.max(POLLEN.radiusIn, cfg.releaseHeightIn);
  state.constraints.maxRpmFraction = Math.min(1, Math.max(0.01, state.ui.maxRpmPct / 100));

  const hs = syncHive();
  const f = cellFrame(cfg.target.hive, cfg.target.cell, hs[cfg.target.hive]);
  const range = floorTargetRange(f, POLLEN.radiusIn);
  cfg.landing.u = Math.min(range.uMax, Math.max(range.uMin, cfg.landing.u));
  cfg.landing.s = Math.min(range.sMax, Math.max(range.sMin, cfg.landing.s));
  refreshInputs();

  const geo = shotGeometry(cfg);
  const violations = checkConstraints(cfg, state.constraints, geo);
  shooter.update({
    releaseIn: geo.releaseIn,
    heading: geo.heading,
    rampAngleDeg: cfg.rampAngleDeg,
    wheelDiameterIn: cfg.wheelDiameterIn,
    rampLengthIn: state.constraints.rampLengthIn,
    robotLengthIn: state.constraints.robotLengthIn,
    robotWidthIn: state.constraints.robotWidthIn,
    valid: violations.length === 0,
  });
  markers.setTarget(geo.targetIn, f.n);
  markers.setBalls(restingBalls(hs));
  traj.timeScale = state.ui.timeScale;

  const floorPts = f.polygon.filter((q) => Math.abs(q[1] - cellFloorV(f)) < 1e-6).map((q) => q[0]);
  picker.draw({
    floor: { uMin: Math.min(...floorPts), uMax: Math.max(...floorPts) },
    sBack: f.sBack,
    sOpen: f.sOpen,
    range,
    landing: cfg.landing,
    radius: POLLEN.radiusIn,
    color: cfg.target.hive === 'red' ? '#d8282b' : '#2f66e8',
    label: `${cfg.target.hive} ${cfg.target.cell}`.toUpperCase(),
  });

  const L = launchFromSetup({ ...cfg, efficiency: cfg.efficiencyPct / 100 });
  document.getElementById('launcher-derived').innerHTML =
    `Wheel ${L.wheelRpm.toFixed(0)} rpm, surface ${fmtSpeed(L.surfaceSpeed, state.ui.units)} -> ball exit ${fmtSpeed(L.exitSpeed, state.ui.units)}, ` +
    `spin ${(L.spinRate * 60 / (2 * Math.PI)).toFixed(0)} rpm ${cfg.spinMode}. Motor at ${((cfg.motorRpm / motor.freeSpeedRpm) * 100).toFixed(0)}% of ${motor.freeSpeedRpm} rpm free speed.`;

  const vl = document.getElementById('violations');
  vl.innerHTML = violations.map((v) => `<li>${v}</li>`).join('');

  if (path && !path.startsWith('ui.')) lastFired = null;
  if (path && path !== 'cfg.load') {
    const lv = document.getElementById('load-verify');
    if (lv) lv.hidden = true;
  }
  if (path === 'ui.criterion' && lastSolve) {
    Object.assign(lastSolve, rankCandidates(lastSolve.candidates, state.ui.criterion));
  }
  renderSolve();
  if (path === 'cfg.load' || path === 'reset') refreshPreviewSync();
  else queuePreview();
  persist();
}

function refreshPreviewSync() {
  previewQueued = false;
  lastPreviewSim = previewSim();
  applyPreviewSim(lastPreviewSim);
  return lastPreviewSim;
}

function queuePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    lastPreviewSim = previewSim();
    applyPreviewSim(lastPreviewSim);
  });
}

// --- Actions -------------------------------------------------------------------
function fire() {
  const hs = syncHive();
  const sim = previewSim();
  lastFired = sim;
  const badge = document.getElementById('result');
  badge.className = 'badge idle';
  badge.textContent = 'IN FLIGHT';
  traj.play(sim, () => {
    if (sim.result.make) {
      resting.push({ cellId: sim.geometry.frame.id, c: sim.final.p, r: POLLEN.radius, kind: 'pollen' });
      markers.setBalls(restingBalls(hs));
    }
    setReadout(sim, state.ui.units, { preview: false });
    queuePreview();
  });
}

function clearHive() {
  const hs = syncHive();
  const id = cellId(state.cfg.target.hive, hs[state.cfg.target.hive]);
  resting = resting.filter((b) => b.cellId !== id);
  state.cfg.stagedNectar = false;
  lastFired = null;
  update('cfg.stagedNectar');
}

let worker = null;
let solveSeq = 0;

function startSolve() {
  const btn = document.getElementById('solve');
  const bar = document.querySelector('#solve-progress > div');
  const hs = syncHive();
  const payload = {
    id: ++solveSeq,
    cfg: simConfig(hs),
    constraints: { ...state.constraints },
    opts: { criterion: state.ui.criterion, angleStep: state.ui.angleStep, rpmStep: state.ui.rpmStep },
  };
  btn.disabled = true;
  bar.style.width = '0%';
  const done = (res) => {
    lastSolve = res;
    lastSolveKey = solveKey();
    btn.disabled = false;
    bar.style.width = '100%';
    renderSolve();
  };
  try {
    worker ??= new Worker(new URL('./physics/solverWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== solveSeq) return;
      if (m.type === 'progress') bar.style.width = `${(m.progress * 100).toFixed(0)}%`;
      else if (m.type === 'done') done(m.result);
      else if (m.type === 'error') {
        console.error(m.message);
        btn.disabled = false;
      }
    };
    worker.onerror = (e) => {
      console.warn('Solver worker failed, running on main thread', e);
      worker = null;
      setTimeout(() => done(solve(payload.cfg, payload.constraints, payload.opts)), 0);
    };
    worker.postMessage(payload);
  } catch (e) {
    console.warn('Web Worker unavailable, solving on main thread', e);
    setTimeout(() => done(solve(payload.cfg, payload.constraints, payload.opts)), 0);
  }
}

function renderSolve() {
  const el = document.getElementById('solve-results');
  renderSolverResults(el, lastSolve, state.ui.units, CRITERIA[state.ui.criterion]?.label ?? '', (c) => {
    state.cfg.rampAngleDeg = c.rampAngleDeg;
    state.cfg.motorRpm = c.motorRpm;
    lastFired = null;
    refreshInputs();
    update('cfg.load');
    const verify = lastPreviewSim ?? previewSim();
    const box = document.getElementById('load-verify');
    if (box) {
      if (verify.result.make) {
        box.hidden = true;
        box.textContent = '';
      } else {
        box.hidden = false;
        box.textContent =
          `Loaded ${c.rampAngleDeg.toFixed(1)}° / ${c.motorRpm.toFixed(0)} rpm — preview now shows MISS (${verify.result.reason}). ` +
          'The solver ran with different obstacles or settings; clear the hive, turn off staged nectar, or solve again.';
      }
    }
  });
  if (lastSolve && lastSolveKey !== solveKey()) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.style.color = '#fb923c';
    p.textContent = 'Settings changed since this solve - press Solve again.';
    el.prepend(p);
  }
  drawSolvePlot(document.getElementById('solve-plot'), lastSolve, state.constraints, motorById(state.cfg.motorId).freeSpeedRpm * state.constraints.maxRpmFraction);
}

document.getElementById('fire').onclick = fire;
document.getElementById('clear-hive').onclick = clearHive;
document.getElementById('clear-trails').onclick = () => traj.clear();
document.getElementById('solve').onclick = startSolve;
document.getElementById('reset').onclick = () => {
  localStorage.removeItem(STORE);
  const d = defaults();
  Object.assign(state, d);
  resting = [];
  lastSolve = null;
  lastFired = null;
  refreshInputs();
  update('reset');
};
for (const b of document.querySelectorAll('[data-view]')) {
  b.onclick = () => {
    const geo = shotGeometry(state.cfg);
    view.setView(b.dataset.view, { releaseIn: geo.releaseIn, heading: geo.heading });
  };
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    fire();
  }
});

update();
