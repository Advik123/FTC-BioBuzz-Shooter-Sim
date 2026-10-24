// Sphere vs. static geometry: convex planar polygons (two-sided thin plates),
// capsules (frame tubes) and static spheres (balls already resting in a cell).
// Impulse model: normal restitution e, Coulomb friction mu with spin coupling.

import { POLLEN } from './ball.js';
import { sub, dot, cross, scale, add } from './vec.js';

/** Closest point on segment ab to p. */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/** Closest point on a convex planar polygon (pts wound CCW about normal). */
export function closestOnPolygon(p, pts, normal) {
  const d = dot(sub(p, pts[0]), normal);
  const q = [p[0] - normal[0] * d, p[1] - normal[1] * d, p[2] - normal[2] * d];
  let inside = true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (dot(cross(sub(b, a), sub(q, a)), normal) < 0) {
      inside = false;
      break;
    }
  }
  if (inside) return q;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const c = closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return best;
}

function closestOnCollider(p, c) {
  if (c.kind === 'poly') return { q: closestOnPolygon(p, c.pts, c.normal), r: 0 };
  if (c.kind === 'capsule') return { q: closestOnSegment(p, c.a, c.b), r: c.r };
  return { q: c.c, r: c.r }; // static sphere
}

export function inAabb(p, aabb, pad) {
  const [mn, mx] = aabb;
  return (
    p[0] > mn[0] - pad && p[0] < mx[0] + pad &&
    p[1] > mn[1] - pad && p[1] < mx[1] + pad &&
    p[2] > mn[2] - pad && p[2] < mx[2] + pad
  );
}

/**
 * Detect and resolve penetration against one collider. Mutates state (p, v, w).
 * Returns a contact record or null.
 */
export function resolveCollider(state, c, ball = POLLEN, restThreshold = 0.05) {
  const r = ball.radius;
  const { q, r: cr } = closestOnCollider(state.p, c);
  const delta = sub(state.p, q);
  const d = Math.hypot(delta[0], delta[1], delta[2]);
  const reach = r + cr;
  if (d >= reach) return null;
  let n;
  if (d > 1e-9) n = scale(delta, 1 / d);
  else if (c.kind === 'poly') n = dot(state.v, c.normal) > 0 ? scale(c.normal, -1) : c.normal;
  else n = [0, 0, 1];
  // positional correction
  const pen = reach - d;
  state.p[0] += n[0] * pen;
  state.p[1] += n[1] * pen;
  state.p[2] += n[2] * pen;
  return applyImpulse(state, n, c.e, c.mu, ball, restThreshold, { tag: c.tag, point: add(state.p, scale(n, -r)) });
}

/** Impulse at a contact with outward normal n (pointing from surface to ball centre). */
export function applyImpulse(state, n, e, mu, ball, restThreshold, info) {
  const r = ball.radius;
  const m = ball.mass;
  const k = ball.inertiaK;
  const I = k * m * r * r;
  const rc = scale(n, -r); // centre -> contact
  const vc = add(state.v, cross(state.w, rc));
  const vn = dot(vc, n);
  if (vn >= 0) return { ...info, normal: n, vn: 0, resting: true };
  const eEff = -vn < restThreshold ? 0 : e;
  const Jn = -(1 + eEff) * m * vn;
  const vtVec = sub(vc, scale(n, vn));
  const vtMag = Math.hypot(vtVec[0], vtVec[1], vtVec[2]);
  let Jt = [0, 0, 0];
  if (vtMag > 1e-9) {
    const jStop = (vtMag * m * k) / (k + 1);
    const j = Math.min(mu * Jn, jStop);
    Jt = scale(vtVec, -j / vtMag);
  }
  const J = add(scale(n, Jn), Jt);
  state.v[0] += J[0] / m;
  state.v[1] += J[1] / m;
  state.v[2] += J[2] / m;
  const dw = scale(cross(rc, Jt), 1 / I);
  state.w[0] += dw[0];
  state.w[1] += dw[1];
  state.w[2] += dw[2];
  return { ...info, normal: n, vn, resting: -vn < restThreshold };
}
