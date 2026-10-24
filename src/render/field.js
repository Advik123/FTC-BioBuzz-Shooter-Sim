// Perimeter, tape, flowers: simple shapes in field coordinates (inches, Z up).
import * as THREE from 'three';
import { D } from '../field/dimensions.js';

const RED = 0xd8282b;
const BLUE = 0x2457d6;

function box(w, d, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildPerimeter() {
  const g = new THREE.Group();
  g.name = 'perimeter';
  const F = D.fieldHalf;
  const H = D.wallHeight;
  const rail = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6, metalness: 0.4 });
  const panel = new THREE.MeshStandardMaterial({ color: 0xcfe3f2, transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const L = 2 * F + 2.14;
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const horizontal = sy !== 0;
    const w = horizontal ? L : 1.07;
    const dd = horizontal ? 1.07 : L;
    const cx = sx * (F + 0.535);
    const cy = sy * (F + 0.535);
    g.add(box(w, dd, 1.13, rail, cx, cy, 0.565 - 0.59));
    g.add(box(w, dd, 1.13, rail, cx, cy, H - 0.565));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? L : H - 1.7, horizontal ? H - 1.7 : L), panel);
    p.position.set(cx, cy, H / 2);
    if (horizontal) p.rotation.x = Math.PI / 2;
    else p.rotation.y = Math.PI / 2;
    g.add(p);
    // posts at panel joints (every ~ tile pitch x2)
    for (let i = -1; i <= 1; i++) {
      const s = i * 2 * D.tilePitch;
      g.add(box(horizontal ? 1.1 : 1.07, horizontal ? 1.07 : 1.1, H, rail, horizontal ? s : cx, horizontal ? cy : s, H / 2 - 0.3));
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(1.6, 1.6, H, rail, sx * (F + 0.535), sy * (F + 0.535), H / 2 - 0.3));
  return g;
}

function tapeRect(minXY, maxXY, color, width = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const [x0, y0] = minXY;
  const [x1, y1] = maxXY;
  const z = 0.03;
  const seg = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, width, 0.04), mat);
    m.position.set((ax + bx) / 2, (ay + by) / 2, z);
    m.rotation.z = Math.atan2(by - ay, bx - ax);
    m.receiveShadow = true;
    g.add(m);
  };
  const F = D.fieldHalf;
  const h = width / 2;
  // skip edges that lie on the perimeter
  if (Math.abs(y0) < F - 0.5) seg(x0, y0 + h, x1, y0 + h);
  if (Math.abs(y1) < F - 0.5) seg(x0, y1 - h, x1, y1 - h);
  if (Math.abs(x0) < F - 0.5) seg(x0 + h, y0, x0 + h, y1);
  if (Math.abs(x1) < F - 0.5) seg(x1 - h, y0, x1 - h, y1);
  return g;
}

export function buildTape() {
  const g = new THREE.Group();
  g.name = 'tape';
  g.add(tapeRect(...D.redLoadingZone, RED));
  g.add(tapeRect(...D.blueLoadingZone, BLUE));
  const gardenMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  for (const [[x0, y0], [x1, y1]] of [D.redGarden]) g.add(box(x1 - x0, y1 - y0, 0.04, gardenMat(RED), (x0 + x1) / 2, (y0 + y1) / 2, 0.03));
  for (const [[x0, y0], [x1, y1]] of [D.blueGarden]) g.add(box(x1 - x0, y1 - y0, 0.04, gardenMat(BLUE), (x0 + x1) / 2, (y0 + y1) / 2, 0.03));
  // Alliance areas outside the field (54 in. deep, ~97 in. wide; setup guide 8.5)
  const F = D.fieldHalf;
  const ground = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, transparent: true, opacity: 0.35 });
  g.add(box(54, 97, 0.05, ground(RED), -(F + 2 + 27), 0, -0.55));
  g.add(box(54, 97, 0.05, ground(BLUE), F + 2 + 27, 0, -0.55));
  // Audience marker
  const aud = box(2 * F, 3, 0.05, new THREE.MeshStandardMaterial({ color: 0x333333 }), 0, -(F + 18), -0.55);
  g.add(aud);
  return g;
}

export function buildFlowers() {
  const g = new THREE.Group();
  g.name = 'flowers';
  const pipe = new THREE.MeshStandardMaterial({ color: 0x3fb83a, roughness: 0.5 });
  const ring = new THREE.MeshStandardMaterial({ color: 0x2e8b2a, roughness: 0.6 });
  const back = new THREE.MeshStandardMaterial({ color: 0x8a46c9, roughness: 0.6 });
  const R = D.flowerRingOD / 2;
  const top = D.flowerTopHeight;
  for (const [x, y] of D.flowerCenters) {
    const f = new THREE.Group();
    f.position.set(x, y, 0);
    for (const z of [top - 0.6, top - 17.5 + 0.6, 0.2]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(R - 0.35, 0.35, 8, 24), ring);
      r.position.z = z;
      r.castShadow = true;
      f.add(r);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 17.5, 10), pipe);
      p.rotation.x = Math.PI / 2;
      p.position.set(Math.cos(a) * (R - 0.4), Math.sin(a) * (R - 0.4), top - 17.5 / 2);
      p.castShadow = true;
      f.add(p);
    }
    // backstop toward the wall
    const toWall = Math.abs(x) > Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)];
    const b = new THREE.Mesh(new THREE.BoxGeometry(toWall[0] ? 0.25 : 5.3, toWall[0] ? 5.3 : 0.25, 1.25), back);
    b.position.set(toWall[0] * (R - 0.2), toWall[1] * (R - 0.2), top + 0.6);
    f.add(b);
    // support down to the wall
    const s = new THREE.Mesh(new THREE.BoxGeometry(toWall[0] ? 1 : 1, toWall[0] ? 1 : 1, top), new THREE.MeshStandardMaterial({ color: 0x777777 }));
    s.position.set(toWall[0] * (R + 0.6), toWall[1] * (R + 0.6), top / 2);
    f.add(s);
    g.add(f);
  }
  return g;
}
