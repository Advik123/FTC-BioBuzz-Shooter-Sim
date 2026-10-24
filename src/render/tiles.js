// 36 interlocking soft foam tiles. Neighbouring tiles share one zig-zag seam
// polyline, so the teeth interlock exactly. Tile pitch and tooth depth from CAD.
import * as THREE from 'three';
import { D } from '../field/dimensions.js';

const SEGMENTS = 10; // teeth segments per tile edge

export function buildTiles() {
  const F = D.fieldHalf;
  const P = D.tilePitch;
  const d = D.tileToothDepth;
  const t = D.tileThickness;
  const w = P / SEGMENTS;
  const group = new THREE.Group();
  group.name = 'tiles';

  // offset of the seam at absolute along-seam coordinate segment k
  const off = (k) => {
    const local = ((k % SEGMENTS) + SEGMENTS) % SEGMENTS;
    if (local === 0 || local === SEGMENTS - 1) return 0;
    return k % 2 === 0 ? d : -d;
  };

  // Points along an edge between a and b (along-coordinate), at fixed coordinate c.
  // interior: whether this edge is a seam. Returns [[along, across], ...]
  function edge(c, a, b, interior) {
    const pts = [];
    const dir = Math.sign(b - a);
    const k0 = Math.round((Math.min(a, b) + F) / w);
    const n = Math.round(Math.abs(b - a) / w);
    for (let i = 0; i < n; i++) {
      const idx = dir > 0 ? i : n - 1 - i;
      const k = k0 + idx;
      const o = interior ? off(k) : 0;
      const s0 = -F + k * w;
      const s1 = s0 + w;
      if (dir > 0) pts.push([s0, c + o], [s1, c + o]);
      else pts.push([s1, c + o], [s0, c + o]);
    }
    return pts;
  }

  const seamPositions = [];
  const shades = [0x86898d, 0x8b8e92, 0x828589, 0x8f9195];
  for (let ix = 0; ix < 6; ix++) {
    for (let iy = 0; iy < 6; iy++) {
      const x0 = -F + ix * P;
      const x1 = x0 + P;
      const y0 = -F + iy * P;
      const y1 = y0 + P;
      const pts = [];
      for (const [s, c] of edge(y0, x0, x1, iy > 0)) pts.push([s, c]); // bottom
      for (const [s, c] of edge(x1, y0, y1, ix < 5)) pts.push([c, s]); // right
      for (const [s, c] of edge(y1, x1, x0, iy < 5)) pts.push([s, c]); // top
      for (const [s, c] of edge(x0, y1, y0, ix > 0)) pts.push([c, s]); // left
      const clean = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
      const shape = new THREE.Shape(clean.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, -t);
      const mat = new THREE.MeshStandardMaterial({ color: shades[(ix * 7 + iy * 3) % shades.length], roughness: 0.97, metalness: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      for (let i = 0; i < clean.length; i++) {
        const a = clean[i];
        const b = clean[(i + 1) % clean.length];
        seamPositions.push(a[0], a[1], 0.02, b[0], b[1], 0.02);
      }
    }
  }
  const seamGeo = new THREE.BufferGeometry();
  seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
  const seams = new THREE.LineSegments(seamGeo, new THREE.LineBasicMaterial({ color: 0x55585c, transparent: true, opacity: 0.6 }));
  group.add(seams);
  return group;
}
