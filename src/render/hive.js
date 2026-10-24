// Hive structure mesh: A-frame, pivots and four cells (two per Hive), built
// from the same geometry functions the physics uses, so what you see is what
// the ball collides with.
import * as THREE from 'three';
import { D } from '../field/dimensions.js';
import { HIVES, CELLS, cellFrame, offsetPolygon, cellFloorV } from '../field/geometry.js';

const COLORS = { red: 0xd8282b, blue: 0x2457d6 };

const frameMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.7, roughness: 0.35 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.3, roughness: 0.6 });
const skinMat = new THREE.MeshPhysicalMaterial({
  color: 0xe8f3ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0,
  side: THREE.DoubleSide, depthWrite: false,
});

/** Matrix taking cell-local (u, v, s) to field coordinates (right-handed basis). */
export function cellMatrix(f) {
  let U = new THREE.Vector3(...f.U);
  const n = new THREE.Vector3(...f.n);
  const a = new THREE.Vector3(...f.a);
  if (new THREE.Vector3().crossVectors(U, n).dot(a) < 0) U = U.negate(); // polygon is symmetric in u
  return new THREE.Matrix4().makeBasis(U, n, a).setPosition(...f.origin);
}

function beam(a, b, size, mat) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, len), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function logoTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#20232a';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#f5c518';
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BIOBUZZ', 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFrame() {
  const g = new THREE.Group();
  g.name = 'frame';
  const [tx, , tz] = D.legTop;
  const [bx, by, bz] = D.legBottom;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) g.add(beam([sx * tx, 0, tz], [sx * bx, sy * by, bz], D.legTube, frameMat));
    // foot bar on the tiles
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.98, D.frameDepth, 2.15), frameMat);
    foot.position.set(sx * D.footBarX, 0, 1.07);
    foot.castShadow = true;
    g.add(foot);
    // top corner + axle holder
    const corner = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 4.7), darkMat);
    corner.position.set(sx * 12.1, 0, 41.85);
    g.add(corner);
  }
  g.add(beam([-D.topBarHalfLength, 0, D.topBarZ], [D.topBarHalfLength, 0, D.topBarZ], 1, frameMat));
  // ACM logo panels
  const tex = logoTexture();
  const [z0, z1] = D.panelZ;
  const hx = D.panelHalfX;
  for (const sy of [-1, 1]) {
    const geo = new THREE.BufferGeometry();
    const p = [[-hx, sy * 4.29, z0], [hx, sy * 4.29, z0], [hx, sy * 1.66, z1], [-hx, sy * 1.66, z1]];
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]], 3));
    const uv = sy < 0 ? [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] : [1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1];
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }));
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function buildCell(f, color) {
  const g = new THREE.Group();
  g.name = f.id;
  g.matrixAutoUpdate = false;
  g.matrix.copy(cellMatrix(f));
  const P = f.polygon;
  const Q = offsetPolygon(P, D.rimWidth);
  const ribMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 });

  // skins (side walls)
  const pos = [];
  for (let i = 0; i < P.length; i++) {
    const [u0, v0] = P[i];
    const [u1, v1] = P[(i + 1) % P.length];
    pos.push(u0, v0, f.sBack, u1, v1, f.sBack, u1, v1, f.sOpen, u0, v0, f.sBack, u1, v1, f.sOpen, u0, v0, f.sOpen);
  }
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skinGeo.computeVertexNormals();
  const skins = new THREE.Mesh(skinGeo, skinMat);
  skins.renderOrder = 2;
  g.add(skins);

  // back skin
  const backShape = new THREE.Shape(P.map(([u, v]) => new THREE.Vector2(u, v)));
  const back = new THREE.Mesh(new THREE.ShapeGeometry(backShape), skinMat);
  back.position.z = f.sBack;
  back.renderOrder = 2;
  g.add(back);

  // ribs: outer profile with the inner profile as a hole
  const ribShape = new THREE.Shape(Q.map(([u, v]) => new THREE.Vector2(u, v)));
  ribShape.holes.push(new THREE.Path([...P].reverse().map(([u, v]) => new THREE.Vector2(u, v))));
  const ribGeo = new THREE.ExtrudeGeometry(ribShape, { depth: D.ribThickness, bevelEnabled: false });
  for (const s0 of [f.sBack, f.sOpen - D.ribThickness]) {
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.position.z = s0;
    rib.castShadow = true;
    g.add(rib);
  }
  // rib edge outlines for readability
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(ribGeo, 20), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35 }));
  outline.position.z = f.sOpen - D.ribThickness;
  g.add(outline);

  // Churro Lite stand-offs at the roof corners and the base tube under the floor
  for (const su of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 10.5, 8), frameMat);
    c.rotation.x = Math.PI / 2;
    c.position.set(su * 9.65, 6.22, 15.46);
    g.add(c);
  }
  const floorV = cellFloorV(f);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 16.75), frameMat);
  tube.position.set(0, floorV - 0.71, 21.46 - 16.75 / 2);
  tube.castShadow = true;
  g.add(tube);

  // AprilTag cluster sticker on the outside bottom of the cell
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(17, 4.3), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }));
  tag.rotation.x = Math.PI / 2;
  tag.position.set(0, floorV - 0.05, 15.5);
  g.add(tag);
  return g;
}

function buildPivot(hive, upCell) {
  const f = cellFrame(hive, 'scoring', upCell);
  const g = new THREE.Group();
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.5, roughness: 0.4 });
  for (const du of [-0.55, 0.55]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 12, 7.3), plateMat);
    plate.position.set(f.origin[0] + du, 0, f.origin[2] - 2.0);
    const ang = Math.atan2(f.a[2], f.a[1]);
    plate.rotation.x = ang;
    g.add(plate);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.2, 12), frameMat);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(...f.origin);
  g.add(axle);
  return g;
}

/** Full Hive structure for a state {red: upCell, blue: upCell}. */
export function buildHive(hiveState) {
  const g = new THREE.Group();
  g.name = 'hive';
  g.add(buildFrame());
  for (const hive of HIVES) {
    g.add(buildPivot(hive, hiveState[hive]));
    for (const cell of CELLS) g.add(buildCell(cellFrame(hive, cell, hiveState[hive]), COLORS[hive]));
  }
  g.traverse((o) => {
    if (o.isMesh && o.material !== skinMat) o.castShadow = true;
  });
  return g;
}
