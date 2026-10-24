// Flywheel-over-ramp launcher model.
//
// The ball is pinched between a flywheel above it and a stationary ramp below.
// With no slip at the ramp, the ramp contact point is instantaneously at rest
// and the wheel drives the top of the ball at the wheel surface speed, so the
// ball centre moves at half the wheel surface speed (rolling-squeeze model):
//     v_ball = eta * v_surface / 2,      v_surface = wheelRPM * 2*pi/60 * R_wheel
// eta (0..1) lumps wheel slip, compression losses and anything else that the
// user calibrates against real shots.
//
// Spin: the ball rolls along the ramp, so it leaves with omega = v_ball / r.
// Rolling forward on a ramp *below* the ball is TOPSPIN (front of the ball
// moving down), which gives a downward Magnus force. 'backspin' is available
// as an override for designs that roll the ball along a hood above it.

import { POLLEN } from './ball.js';
import { cross, scale, add } from './vec.js';
import { IN } from '../field/dimensions.js';

export const SPIN_MODES = Object.freeze({
  topspin: 'Topspin (wheel above, ramp below - physical default)',
  backspin: 'Backspin (override: ball rolls along a hood above it)',
  none: 'No spin',
});

export function wheelRpm(motorRpm, gearRatio = 1) {
  return motorRpm / gearRatio;
}

/**
 * @param {object} p
 * @param {number} p.motorRpm       motor output shaft RPM
 * @param {number} p.gearRatio      motor turns per flywheel turn (1 = direct, 0.5 = wheel spins 2x motor)
 * @param {number} p.wheelDiameterIn
 * @param {number} p.efficiency     0..1 (slip / efficiency)
 * @param {string} p.spinMode       key of SPIN_MODES
 */
export function launchFromSetup({ motorRpm, gearRatio = 1, wheelDiameterIn, efficiency, spinMode = 'topspin' }) {
  const wRpm = wheelRpm(motorRpm, gearRatio);
  const surfaceSpeed = (wRpm * 2 * Math.PI) / 60 * ((wheelDiameterIn * IN) / 2);
  const exitSpeed = (efficiency * surfaceSpeed) / 2;
  const spinRate = spinMode === 'none' ? 0 : exitSpeed / POLLEN.radius;
  const spinSign = spinMode === 'backspin' ? 1 : spinMode === 'topspin' ? -1 : 0;
  return { wheelRpm: wRpm, surfaceSpeed, exitSpeed, spinRate, spinSign };
}

/** Inverse of launchFromSetup for the exit speed. */
export function motorRpmForExitSpeed(exitSpeed, { gearRatio = 1, wheelDiameterIn, efficiency }) {
  const surfaceSpeed = (2 * exitSpeed) / efficiency;
  const wRpm = (surfaceSpeed / ((wheelDiameterIn * IN) / 2)) * 60 / (2 * Math.PI);
  return wRpm * gearRatio;
}

/**
 * Initial ball state.
 * @param {number[]} release  release point (m)
 * @param {number} headingRad azimuth of travel in the XY plane
 * @param {number} rampAngleDeg launch elevation
 */
export function launchState(release, headingRad, rampAngleDeg, exitSpeed, spinRate, spinSign) {
  const h = [Math.cos(headingRad), Math.sin(headingRad), 0];
  const th = (rampAngleDeg * Math.PI) / 180;
  const v = add(scale(h, exitSpeed * Math.cos(th)), [0, 0, exitSpeed * Math.sin(th)]);
  const backspinAxis = cross(h, [0, 0, 1]);
  const w = scale(backspinAxis, spinSign * spinRate);
  return { p: [...release], v, w };
}
