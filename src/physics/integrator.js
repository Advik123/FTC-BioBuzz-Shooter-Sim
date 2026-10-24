// Free-flight dynamics: gravity + quadratic drag + Magnus lift, RK4 integration.
// Spin is held constant during free flight (spin decay neglected).

import { POLLEN, crossSection } from './ball.js';

export const DEFAULT_AERO = Object.freeze({
  g: 9.80665, // m/s^2
  rho: 1.204, // kg/m^3, dry air at 20 C, sea level
  cd: 0.5, // drag coefficient (assumption, see README)
  clSlope: 0.6, // Cl = min(clMax, clSlope * S), S = r*omega/v (assumption)
  clMax: 0.35,
  drag: true,
  magnus: true,
});

export function liftCoefficient(S, aero) {
  return Math.min(aero.clMax, aero.clSlope * S);
}

/** Acceleration (m/s^2) for velocity v and spin w. Writes into out. */
export function acceleration(v, w, aero, out = [0, 0, 0], ball = POLLEN) {
  out[0] = 0;
  out[1] = 0;
  out[2] = -aero.g;
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (speed < 1e-9) return out;
  const k = (0.5 * aero.rho * crossSection(ball.radius)) / ball.mass;
  if (aero.drag) {
    const f = -k * aero.cd * speed;
    out[0] += f * v[0];
    out[1] += f * v[1];
    out[2] += f * v[2];
  }
  if (aero.magnus) {
    const wmag = Math.hypot(w[0], w[1], w[2]);
    if (wmag > 1e-9) {
      const S = (ball.radius * wmag) / speed;
      const cl = liftCoefficient(S, aero);
      // F = 0.5 rho A Cl v^2 * (w x v) / (|w||v|)
      const cx = w[1] * v[2] - w[2] * v[1];
      const cy = w[2] * v[0] - w[0] * v[2];
      const cz = w[0] * v[1] - w[1] * v[0];
      const f = (k * cl * speed) / wmag;
      out[0] += f * cx;
      out[1] += f * cy;
      out[2] += f * cz;
    }
  }
  return out;
}

const a1 = [0, 0, 0];
const a2 = [0, 0, 0];
const a3 = [0, 0, 0];
const a4 = [0, 0, 0];
const vt = [0, 0, 0];

/** One RK4 step of (p, v) with constant spin. Mutates state.p and state.v. */
export function rk4Step(state, dt, aero, ball = POLLEN) {
  const { p, v, w } = state;
  acceleration(v, w, aero, a1, ball);
  for (let i = 0; i < 3; i++) vt[i] = v[i] + 0.5 * dt * a1[i];
  const v2 = [vt[0], vt[1], vt[2]];
  acceleration(v2, w, aero, a2, ball);
  for (let i = 0; i < 3; i++) vt[i] = v[i] + 0.5 * dt * a2[i];
  const v3 = [vt[0], vt[1], vt[2]];
  acceleration(v3, w, aero, a3, ball);
  for (let i = 0; i < 3; i++) vt[i] = v[i] + dt * a3[i];
  const v4 = [vt[0], vt[1], vt[2]];
  acceleration(v4, w, aero, a4, ball);
  for (let i = 0; i < 3; i++) {
    p[i] += (dt / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
    v[i] += (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
  }
  return state;
}
