// BIOBUZZ field dimensions. Every value carries a source tag:
//   manual      - Competition Manual Section 9 (nominal, +/- 1 in.)
//   checklist   - 2026-2027 Field Acceptance Checklist
//   guide       - Initial Field Element Assembly Guide / Event Field Setup Guide
//   cad         - measured from the official STEP export (Field CAD v26-27.2)
//                 with tools/step_extract.py
//   placeholder - not found in any official source; must be verified
//
// Field frame (used everywhere): origin at field centre on the tile top surface,
// +X toward the BLUE alliance wall, +Y away from the audience (toward the
// scoring table), +Z up. All lengths here are inches.

export const SOURCES = {
  manual: 'Competition Manual Sec. 9 (nominal)',
  checklist: 'Field Acceptance Checklist 26-27',
  guide: 'Field assembly / setup guides',
  cad: 'Official STEP CAD v26-27.2',
  placeholder: 'PLACEHOLDER - needs verification',
};

const s = (value, source, ref) => Object.freeze({ value, source, ref });

export const SPEC = Object.freeze({
  // --- Field -----------------------------------------------------------------
  fieldNominal: s(144, 'manual', '9.2: approx. 144 x 144 in. inside the perimeter'),
  fieldHalf: s(70.58, 'cad', 'Perimeter rail inner faces at +/-70.58 in. (141.16 in. inside); manual nominal is 144 in.'),
  tileNominal: s(24, 'manual', '9.2: tiles approx. 24 x 24 x 0.59 in.'),
  tileThickness: s(0.59, 'manual', '9.2'),
  tilePitch: s(23.527, 'cad', '6 tiles span the 141.16 in. CAD floor'),
  tileToothDepth: s(0.38, 'cad', 'Tile interlock teeth protrude ~0.38-0.41 in. beyond the tile body'),
  wallHeight: s(12.2, 'cad', 'Top rail of am-0481 perimeter reaches 11.64 in. above tiles (+ rail lip)'),

  // --- Hive frame ----------------------------------------------------------
  frameWidth: s(49.46, 'manual', '9.6.1 frame width at base'),
  frameDepth: s(38.95, 'manual', '9.6.1 frame depth at base'),
  pivotHeight: s(43.95, 'manual', '9.6.1 pivot axis height above tiles (CAD bearings agree)'),
  footBarX: s(23.74, 'cad', 'Sheet-metal foot bar centrelines at X = +/-23.74 in.'),
  topBarZ: s(41.45, 'cad', 'A-Frame Top Bar centre height'),
  topBarHalfLength: s(12.0, 'cad', 'A-Frame Top Bar spans X = -12 to +12 in. (24 in. part, guide)'),
  legTop: s([12.9, 0.0, 40.9], 'cad', 'A-Frame Leg upper end (X, Y, Z), mirrored for the 4 legs'),
  legBottom: s([23.8, 18.6, 0.7], 'cad', 'A-Frame Leg lower end (X, Y, Z), mirrored for the 4 legs'),
  legTube: s(1.0, 'cad', '1 in. square leg tube'),
  panelZ: s([34.1, 40.0], 'cad', 'ACM logo panel vertical extent'),
  panelHalfX: s(15.07, 'cad', 'ACM logo panel half width'),

  // --- Hive / Cell -----------------------------------------------------------
  hiveCenterX: s(12.77, 'cad', 'Cell centreline offset from field centre: red at -X, blue at +X'),
  cellTiltDeg: s(30.0, 'cad', 'Hive arm / cell tube axis is 30.0 deg above horizontal in either stable state'),
  cellSpacing: s(18.8, 'manual', '9.6.2 cells approx. 18.8 in. apart (CAD inner rib faces: 18.88 in.)'),
  cellBackS: s(9.44, 'cad', 'Back skin plane: 9.44 in. from pivot along the cell axis'),
  cellOpenS: s(21.46, 'cad', 'Opening (outer rib face): 21.46 in. from pivot along the cell axis'),
  cellDepth: s(12, 'manual', '9.6.2 cell depth approx. 12 in. (CAD 12.02 in.)'),
  cellOpeningWidth: s(20, 'manual', '9.6.2 opening approx. 20 in. wide (CAD inner 20.2 in.)'),
  cellOpeningHeight: s(14, 'manual', '9.6.2 opening approx. 14 in. tall (CAD inner 14.27 in.)'),
  ribThickness: s(2.0, 'cad', 'Goal Rib thickness along the cell axis'),
  rimWidth: s(0.35, 'cad', 'Goal Rib lip: outer profile ~0.35 in. outside the skin line'),
  // Inner cross-section (u = along pivot axis, v = perpendicular to the cell
  // axis, positive toward the cell roof, measured from the pivot axis line).
  cellInnerPolygon: s([
    [-8.7, -1.5], [8.7, -1.5], [10.1, -0.4], [10.1, 5.9], [0.0, 12.77], [-10.1, 5.9], [-10.1, -0.4],
  ], 'cad', 'Goal Rib inner profile sampled from CAD vertices (fillets approximated by chamfers)'),
  cellLipCheck: s(53.5, 'checklist', '1.13: bottom of upright cell opening 53.5 +/- 0.5 in. above tiles (model gives 53.4)'),

  // --- Other elements ------------------------------------------------------
  flowerTopHeight: s(21.5, 'manual', '9.7 top opening approx. 21.5 in. above tiles'),
  flowerTopDiameter: s(4, 'manual', '9.7 top opening approx. 4 in. diameter'),
  flowerRingOD: s(5.86, 'cad', 'Flower Layer C outer extent'),
  flowerCenters: s([[23.4, -68.0], [68.0, 23.4], [-68.0, -23.4], [-23.4, 68.0]], 'cad', 'Flower ring centres (X, Y)'),
  loadingZoneWidth: s(23, 'manual', '9.3 loading zone approx. 23 x 11 in.'),
  loadingZoneDepth: s(11, 'manual', '9.3'),
  redLoadingZone: s([[-70.58, 23.91], [-59.1, 47.41]], 'cad', 'Red loading zone [minXY, maxXY] incl. tape'),
  blueLoadingZone: s([[59.1, -47.41], [70.58, -23.91]], 'cad', 'Blue loading zone [minXY, maxXY] incl. tape'),
  redGarden: s([[-70.1, -70.58], [-47.41, -68.1]], 'cad', 'Red garden tape on tile A1'),
  blueGarden: s([[47.41, 68.1], [70.1, 70.58]], 'cad', 'Blue garden tape on tile F6'),

  // --- Scoring elements (fixed, not editable) ------------------------------
  pollenDiameter: s(2.8, 'manual', '9.8 POLLEN approx. 2.8 in. (7.1 cm)'),
  pollenMassLb: s(0.055, 'manual', 'Task spec: 0.055 lb (about 25 g)'),
  nectarDiameter: s(3.6, 'manual', '9.8 NECTAR approx. 3.6 in. (9.1 cm)'),

  // --- Robot rules -----------------------------------------------------------
  startingCube: s(18, 'manual', 'R102 STARTING CONFIGURATION 18 in. cube'),
  expansionHeight: s(29, 'manual', 'R105 expanded robot <= 29 in. tall'),
  expansionFootprint: s([18, 24], 'manual', 'R105 expanded footprint 18 x 24 in.'),

  // --- Material / contact properties (not in any official source) ------------
  restitutionSkin: s(0.45, 'placeholder', 'Pollen vs. clear polycarbonate cell skin'),
  restitutionRib: s(0.5, 'placeholder', 'Pollen vs. injection-moulded Goal Rib'),
  restitutionFrame: s(0.55, 'placeholder', 'Pollen vs. aluminium frame tube'),
  restitutionBall: s(0.5, 'placeholder', 'Pollen vs. resting Pollen / Nectar'),
  frictionSkin: s(0.3, 'placeholder', 'Coulomb friction, Pollen vs. skin'),
  frictionRib: s(0.4, 'placeholder', 'Coulomb friction, Pollen vs. rib'),
  frictionFrame: s(0.3, 'placeholder', 'Coulomb friction, Pollen vs. frame'),
  frictionBall: s(0.3, 'placeholder', 'Coulomb friction, Pollen vs. ball'),
});

// Plain numbers for convenience.
export const D = Object.freeze(Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v.value])));

export const IN = 0.0254; // metres per inch

/** Rows for the README / UI "sources" table. */
export function specTable() {
  return Object.entries(SPEC).map(([key, v]) => ({ key, value: v.value, source: v.source, ref: v.ref }));
}
