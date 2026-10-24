// POLLEN scoring element. Fixed to the official spec; not user-editable.
import { D, IN } from '../field/dimensions.js';

const LB = 0.45359237;

export const POLLEN = Object.freeze({
  diameterIn: D.pollenDiameter,
  radiusIn: D.pollenDiameter / 2,
  radius: (D.pollenDiameter / 2) * IN, // m
  mass: D.pollenMassLb * LB, // kg (~0.02495)
  // Hollow polyethylene shell: I = k m r^2 with k = 2/3 (thin shell). Assumption.
  inertiaK: 2 / 3,
});

export const NECTAR_RADIUS = (D.nectarDiameter / 2) * IN;

export const crossSection = (r = POLLEN.radius) => Math.PI * r * r;
