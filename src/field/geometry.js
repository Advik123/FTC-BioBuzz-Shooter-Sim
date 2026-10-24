// Pure field geometry derived from dimensions.js. No Three.js, no DOM.
// Positions returned by the cell helpers are in inches (field frame);
// buildColliders() converts to metres for the physics engine.

import { D, IN } from './dimensions.js';
import { add, scale, sub, dot, cross, norm, rad } from '../physics/vec.js';

export const HIVES = ['red', 'blue'];
export const CELLS = ['audience', 'scoring'];

/** Match-start state (Event Field Setup Guide 11.1): red audience cell up, blue scoring cell up. */
export function defaultHiveState() {
  return { red: 'audience', blue: 'scoring' };
}

export const cellId = (hive, cell) => `${hive}-${cell}`;

const sideSign = (cell) => (cell === 'scoring' ? 1 : -1);
const hiveX = (hive) => (hive === 'red' ? -D.hiveCenterX : D.hiveCenterX);

/**
 * Local frame of one cell for a given Hive state (which cell of this Hive is up).
 *  u: along the pivot axis (+X)
 *  n: perpendicular to the cell axis, toward the cell roof (always has +Z component)
 *  a: cell axis, from pivot toward the opening
 * World point = origin + u*U + v*n + s*a.
 */
export function cellFrame(hive, cell, upCell) {
  const alpha = rad(D.cellTiltDeg);
  const up = sideSign(upCell);
  const d = [0, Math.cos(alpha), up * Math.sin(alpha)]; // pivot -> scoring-side cell
  const n = [0, -up * Math.sin(alpha), Math.cos(alpha)];
  const a = scale(d, sideSign(cell));
  return {
    hive,
    cell,
    id: cellId(hive, cell),
    isUp: cell === upCell,
    origin: [hiveX(hive), 0, D.pivotHeight],
    U: [1, 0, 0],
    n,
    a,
    sBack: D.cellBackS,
    sOpen: D.cellOpenS,
    polygon: ccw(D.cellInnerPolygon),
  };
}

export function cellToWorld(f, u, v, s) {
  return add(add(add(f.origin, scale(f.U, u)), scale(f.n, v)), scale(f.a, s));
}

export function worldToCell(f, p) {
  const r = sub(p, f.origin);
  return { u: dot(r, f.U), v: dot(r, f.n), s: dot(r, f.a) };
}

/** Floor of the cell (lowest polygon edge) as v value. */
export function cellFloorV(f) {
  return Math.min(...f.polygon.map((q) => q[1]));
}

/** Allowed (u, s) range for a ball centre resting on the cell floor. */
export function floorTargetRange(f, ballRadiusIn) {
  const floorV = cellFloorV(f);
  const floorPts = f.polygon.filter((q) => Math.abs(q[1] - floorV) < 1e-6).map((q) => q[0]);
  return {
    uMin: Math.min(...floorPts) + ballRadiusIn,
    uMax: Math.max(...floorPts) - ballRadiusIn,
    sMin: f.sBack + ballRadiusIn,
    sMax: f.sOpen - ballRadiusIn,
  };
}

/** World position (inches) of a ball centre resting on the cell floor at (u, s). */
export function floorTargetWorld(f, u, s, ballRadiusIn) {
  return cellToWorld(f, u, cellFloorV(f) + ballRadiusIn, s);
}

/** Is a point (inches) inside the cell volume, optionally shrunk by margin? */
export function insideCell(f, p, margin = 0) {
  const { u, v, s } = worldToCell(f, p);
  if (s < f.sBack + margin || s > f.sOpen - margin) return false;
  return pointInPolygon2(f.polygon, u, v, margin);
}

/** Opening polygon in world inches (inner profile at the opening plane). */
export function openingPolygonWorld(f) {
  return f.polygon.map(([u, v]) => cellToWorld(f, u, v, f.sOpen));
}

/** Bottom-centre of the opening (the lip) in world inches. */
export function openingLipWorld(f) {
  return cellToWorld(f, 0, cellFloorV(f), f.sOpen);
}

/** Horizontal unit vector pointing out of the opening (from the cell toward a shooter). */
export function outwardHorizontal(f) {
  return norm([f.a[0], f.a[1], 0]);
}

/** Three NECTAR staged in each upward cell (Manual 10.x / setup guide 11.1). */
export function stagedNectarCentres(f) {
  const r = D.nectarDiameter / 2;
  const allianceSign = f.hive === 'red' ? -1 : 1;
  const floorV = cellFloorV(f);
  const uSide = 10.1 - r;
  return [0, 1, 2].map((i) => cellToWorld(f, allianceSign * (uSide - i * 2 * r), floorV + r, f.sBack + r));
}

// ---------------------------------------------------------------------------
// Colliders (metres)
// ---------------------------------------------------------------------------

/**
 * Build all static colliders for a Hive state.
 * Returns groups: [{ id, aabb:[min,max], items:[collider] }]
 * collider = { kind:'poly', pts, normal, e, mu, tag } | { kind:'capsule', a, b, r, e, mu, tag }
 */
export function buildColliders(hiveState) {
  const groups = [];
  for (const hive of HIVES) {
    for (const cell of CELLS) {
      const f = cellFrame(hive, cell, hiveState[hive]);
      groups.push(makeGroup(f.id, cellColliders(f)));
    }
  }
  groups.push(makeGroup('frame', frameColliders()));
  return groups;
}

function cellColliders(f) {
  const out = [];
  const P = f.polygon;
  const Q = offsetPolygon(P, D.rimWidth);
  const m = (p) => scale(p, IN);
  const W = (q, s) => m(cellToWorld(f, q[0], q[1], s));
  const sRibIn = f.sOpen - D.ribThickness;
  const skin = { e: D.restitutionSkin, mu: D.frictionSkin };
  const rib = { e: D.restitutionRib, mu: D.frictionRib };
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    out.push(poly([W(P[i], f.sBack), W(P[j], f.sBack), W(P[j], f.sOpen), W(P[i], f.sOpen)], skin, `${f.id}:wall${i}`));
    out.push(poly([W(P[i], f.sOpen), W(Q[i], f.sOpen), W(Q[j], f.sOpen), W(P[j], f.sOpen)], rib, `${f.id}:rim${i}`));
    out.push(poly([W(Q[i], sRibIn), W(Q[j], sRibIn), W(Q[j], f.sOpen), W(Q[i], f.sOpen)], rib, `${f.id}:ribOuter${i}`));
  }
  out.push(poly(P.map((q) => W(q, f.sBack)), skin, `${f.id}:back`));
  return out;
}

function frameColliders() {
  const out = [];
  const r = (D.legTube / 2) * IN;
  const mat = { e: D.restitutionFrame, mu: D.frictionFrame };
  const [tx, , tz] = D.legTop;
  const [bx, by, bz] = D.legBottom;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      out.push(capsule([sx * tx * IN, 0, tz * IN], [sx * bx * IN, sy * by * IN, bz * IN], r, mat, 'frame:leg'));
    }
  }
  out.push(capsule([-D.topBarHalfLength * IN, 0, D.topBarZ * IN], [D.topBarHalfLength * IN, 0, D.topBarZ * IN], r, mat, 'frame:topBar'));
  const [z0, z1] = D.panelZ;
  const hx = D.panelHalfX;
  for (const sy of [-1, 1]) {
    const pts = [[-hx, sy * 4.29, z0], [hx, sy * 4.29, z0], [hx, sy * 1.66, z1], [-hx, sy * 1.66, z1]].map((p) => scale(p, IN));
    out.push(poly(pts, mat, 'frame:panel'));
  }
  return out;
}

function poly(pts, mat, tag) {
  const normal = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  return { kind: 'poly', pts, normal, e: mat.e, mu: mat.mu, tag };
}

function capsule(a, b, r, mat, tag) {
  return { kind: 'capsule', a, b, r, e: mat.e, mu: mat.mu, tag };
}

function makeGroup(id, items) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of items) {
    const pts = c.kind === 'poly' ? c.pts : [c.a, c.b];
    const pad = c.kind === 'capsule' ? c.r : 0;
    for (const p of pts) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k] - pad);
        max[k] = Math.max(max[k], p[k] + pad);
      }
    }
  }
  return { id, aabb: [min, max], items };
}

// ---------------------------------------------------------------------------
// 2D polygon helpers
// ---------------------------------------------------------------------------

function area2(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function ccw(P) {
  return area2(P) >= 0 ? P.map((q) => [...q]) : [...P].reverse().map((q) => [...q]);
}

/** Outward offset of a convex CCW polygon by distance w. */
export function offsetPolygon(P, w) {
  const n = P.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % n];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    const nx = dy / l;
    const ny = -dx / l; // outward for CCW
    lines.push({ p: [x0 + nx * w, y0 + ny * w], d: [dx, dy] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n];
    const L2 = lines[i];
    const den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    out.push([L1.p[0] + L1.d[0] * t, L1.p[1] + L1.d[1] * t]);
  }
  return out;
}

/** Point in convex CCW polygon, shrunk inward by margin. */
export function pointInPolygon2(P, x, y, margin = 0) {
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    // signed distance to the left of the edge (inside for CCW)
    const sd = (dx * (y - y0) - dy * (x - x0)) / l;
    if (sd < margin) return false;
  }
  return true;
}

/** Smallest distance from (x, y) to the polygon boundary (positive inside). */
export function polygonClearance(P, x, y) {
  let best = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    best = Math.min(best, (dx * (y - y0) - dy * (x - x0)) / l);
  }
  return best;
}
