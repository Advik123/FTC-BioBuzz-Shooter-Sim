// goBILDA 5203 Yellow Jacket motors. Values from goBILDA published spec sheets
// (No-Load Speed / Stall Torque / Stall Current @ 12 VDC), retrieved Oct 2026:
//   https://www.gobilda.com/content/spec_sheets/5203-2402-0001_spec_sheet.pdf
//   https://www.gobilda.com/content/spec_sheets/5203-2402-0003_spec_sheet.pdf
//   https://www.gobilda.com/content/spec_sheets/5203-2402-0005_spec_sheet.pdf

export const MOTORS = Object.freeze([
  {
    id: '5203-2402-0001',
    name: 'goBILDA 5203 Yellow Jacket 6000 RPM (1:1)',
    freeSpeedRpm: 6000,
    stallTorqueKgCm: 1.47,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
  },
  {
    id: '5203-2402-0003',
    name: 'goBILDA 5203 Yellow Jacket 1620 RPM (3.7:1)',
    freeSpeedRpm: 1620,
    stallTorqueKgCm: 5.4,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
  },
  {
    id: '5203-2402-0005',
    name: 'goBILDA 5203 Yellow Jacket 1150 RPM (5.2:1)',
    freeSpeedRpm: 1150,
    stallTorqueKgCm: 7.9,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
  },
]);

export const DEFAULT_MOTOR_ID = '5203-2402-0001';

export function motorById(id) {
  return MOTORS.find((m) => m.id === id) ?? MOTORS[0];
}
