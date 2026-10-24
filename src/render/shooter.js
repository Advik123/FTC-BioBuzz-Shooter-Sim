// Shooter ghost (18 in. starting cube, ramp, flywheel), landing-target marker
// and balls resting in cells.
import * as THREE from 'three';
import { IN } from '../field/dimensions.js';
import { POLLEN } from '../physics/ball.js';
import { ballMesh, pollenMaterial, nectarMaterials } from './trajectory.js';

export class ShooterView {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'shooter';
    parent.add(this.group);
  }

  update({ releaseIn, heading, rampAngleDeg, wheelDiameterIn, rampLengthIn, robotLengthIn, robotWidthIn, valid }) {
    const g = this.group;
    g.clear();
    g.position.set(releaseIn[0], releaseIn[1], 0);
    g.rotation.set(0, 0, heading);
    const zRel = releaseIn[2];
    const L = robotLengthIn;
    const W = robotWidthIn;

    const color = valid ? 0x38bdf8 : 0xf97316;
    const cubeGeo = new THREE.BoxGeometry(L, W, 18);
    const cube = new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    cube.position.set(-L / 2, 0, 9);
    g.add(cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cubeGeo), new THREE.LineBasicMaterial({ color }));
    edges.position.copy(cube.position);
    g.add(edges);
    if (zRel > 18) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1, 1, zRel - 18), new THREE.MeshStandardMaterial({ color: 0x64748b }));
      mast.position.set(-2, 0, 18 + (zRel - 18) / 2);
      g.add(mast);
    }

    const th = (rampAngleDeg * Math.PI) / 180;
    const r = POLLEN.radiusIn;
    const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const nrm = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th));
    const end = new THREE.Vector3(0, 0, zRel).addScaledVector(nrm, -r);
    const len = Math.max(2, rampLengthIn);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 0.25), new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.4, roughness: 0.4 }));
    ramp.position.copy(end).addScaledVector(dir, -len / 2).addScaledVector(nrm, -0.125);
    ramp.rotation.y = -th;
    g.add(ramp);

    const R = wheelDiameterIn / 2;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.5, 32), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }));
    wheel.position.copy(end).addScaledVector(dir, -Math.min(len * 0.5, R + 0.5)).addScaledVector(nrm, 2 * r + R - 0.1);
    g.add(wheel);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
    ring.position.set(0, 0, zRel);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
}

export class MarkersView {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.target = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(POLLEN.radiusIn, 0.15, 8, 32), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(POLLEN.radiusIn, 20, 14), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.25, depthWrite: false }));
    ghost.position.z = POLLEN.radiusIn;
    this.target.add(ring, ghost);
    this.group.add(this.target);
    this.balls = new THREE.Group();
    this.group.add(this.balls);
  }

  setTarget(centreIn, normal, visible = true) {
    const n = new THREE.Vector3(...normal);
    this.target.visible = visible;
    this.target.position.set(...centreIn).addScaledVector(n, -POLLEN.radiusIn + 0.05);
    this.target.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  /** balls: [{ c:[m], r:m, kind:'pollen'|'nectar', color }] */
  setBalls(balls) {
    this.balls.clear();
    for (const b of balls) {
      const mat = b.kind === 'nectar' ? nectarMaterials[b.color] : pollenMaterial;
      const m = ballMesh(b.r / IN, mat);
      m.position.set(b.c[0] / IN, b.c[1] / IN, b.c[2] / IN);
      this.balls.add(m);
    }
  }
}
