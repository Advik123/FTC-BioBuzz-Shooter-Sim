// Trajectory lines, bounce markers, the animated ball, and the live preview.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { IN } from '../field/dimensions.js';
import { POLLEN } from '../physics/ball.js';

const MAKE = 0x22c55e;
const MISS = 0xef4444;
const MAX_TRAILS = 10;

const toIn = (p) => [p[0] / IN, p[1] / IN, p[2] / IN];

export const pollenMaterial = new THREE.MeshStandardMaterial({ color: 0xf4d417, roughness: 0.55 });
export const nectarMaterials = {
  red: new THREE.MeshStandardMaterial({ color: 0xd8282b, roughness: 0.5 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2457d6, roughness: 0.5 }),
};

export function ballMesh(radiusIn = POLLEN.radiusIn, mat = pollenMaterial) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radiusIn, 24, 16), mat);
  m.castShadow = true;
  return m;
}

function fatLine(pointsIn, color, width, dashed = false) {
  const geo = new LineGeometry();
  geo.setPositions(pointsIn.flat());
  const mat = new LineMaterial({ color, linewidth: width, dashed, dashSize: 2, gapSize: 1.5, transparent: true, opacity: dashed ? 0.75 : 1 });
  const line = new Line2(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
}

export class TrajectoryView {
  constructor(parent, renderer) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'trajectories';
    parent.add(this.group);
    this.trails = [];
    this.preview = null;
    this.anim = null;
    this.timeScale = 1;
    this.ball = ballMesh();
    this.ball.visible = false;
    this.group.add(this.ball);
  }

  _resolution(mat) {
    const s = this.renderer.getSize(new THREE.Vector2());
    mat.resolution.set(s.x, s.y);
  }

  setPreview(sim) {
    if (this.preview) {
      this.group.remove(this.preview);
      this.preview.geometry.dispose();
      this.preview.material.dispose();
      this.preview = null;
    }
    if (!sim || !sim.points || sim.points.length < 2) return;
    const pts = sim.points.map(toIn);
    this.preview = fatLine(pts, sim.result.make ? MAKE : MISS, 2, true);
    this._resolution(this.preview.material);
    this.group.add(this.preview);
  }

  setPreviewVisible(v) {
    if (this.preview) this.preview.visible = v;
  }

  /** Animate a shot; calls onDone when the ball reaches the end. */
  play(sim, onDone) {
    this.finish();
    const pts = sim.points.map(toIn);
    const color = sim.result.make ? MAKE : MISS;
    const line = fatLine(pts, color, 4);
    this._resolution(line.material);
    line.geometry.instanceCount = 0;
    const trail = new THREE.Group();
    trail.add(line);
    for (const e of sim.events) {
      if (e.type !== 'contact' && e.type !== 'floor') continue;
      if (e.type === 'contact' && Math.abs(e.vn ?? 0) < 0.15) continue;
      const mk = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mk.position.set(...toIn(e.p));
      mk.visible = false;
      mk.userData.t = e.t;
      trail.add(mk);
    }
    this.group.add(trail);
    this.trails.push(trail);
    while (this.trails.length > MAX_TRAILS) {
      const old = this.trails.shift();
      this.group.remove(old);
      old.traverse((o) => { o.geometry?.dispose(); });
    }
    this.trails.forEach((t, i) => {
      const op = 0.25 + 0.75 * ((i + 1) / this.trails.length);
      t.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = op; } });
    });
    this.ball.visible = true;
    this.ball.position.set(...pts[0]);
    this.anim = { sim, pts, line, trail, t: 0, i: 0, onDone };
  }

  finish() {
    if (!this.anim) return;
    const { pts, line, trail, onDone } = this.anim;
    line.geometry.instanceCount = pts.length - 1;
    trail.children.forEach((c) => { c.visible = true; });
    this.ball.visible = false;
    this.anim = null;
    onDone?.();
  }

  tick(dt) {
    const s = this.renderer.getSize(new THREE.Vector2());
    for (const t of this.trails) t.children[0].material.resolution.set(s.x, s.y);
    if (this.preview) this.preview.material.resolution.set(s.x, s.y);
    const a = this.anim;
    if (!a) return;
    a.t += dt * this.timeScale;
    const times = a.sim.times;
    while (a.i < times.length - 1 && times[a.i + 1] <= a.t) a.i++;
    if (a.i >= times.length - 1) {
      this.finish();
      return;
    }
    const f = (a.t - times[a.i]) / Math.max(1e-9, times[a.i + 1] - times[a.i]);
    const p0 = a.pts[a.i];
    const p1 = a.pts[a.i + 1];
    this.ball.position.set(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f);
    a.line.geometry.instanceCount = Math.max(0, a.i);
    for (const c of a.trail.children) if (c.userData.t !== undefined && c.userData.t <= a.t) c.visible = true;
  }

  clear() {
    this.finish();
    for (const t of this.trails) {
      this.group.remove(t);
      t.traverse((o) => { o.geometry?.dispose(); });
    }
    this.trails = [];
  }
}
