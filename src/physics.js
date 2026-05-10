import * as CANNON from 'cannon-es';
import { readDieValue } from './dice.js';

export class DicePhysics {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.restitution = 0.22;
    this.world.defaultContactMaterial.friction = 0.75;

    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(ground);

    const addWall = (x, z, nx, nz) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      b.position.set(x, 0, z);
      const defaultN = new CANNON.Vec3(0, 0, 1);
      const targetN = new CANNON.Vec3(nx, 0, nz);
      const q = new CANNON.Quaternion();
      q.setFromVectors(defaultN, targetN);
      b.quaternion.copy(q);
      this.world.addBody(b);
    };
    addWall(0, -5,  0,  1);
    addWall(0,  5,  0, -1);
    addWall(-7, 0,  1,  0);
    addWall( 7, 0, -1,  0);

    this.bodies = [];
    for (let i = 0; i < 5; i++) {
      const b = new CANNON.Body({
        mass: 0.6,
        shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
        sleepSpeedLimit: 0.15,
        sleepTimeLimit: 0.4,
        linearDamping: 0.08,
        angularDamping: 0.12,
      });
      b.allowSleep = true;
      b.position.set(20, -20, 0);
      this.world.addBody(b);
      this.bodies.push(b);
    }
    this.activeIndices = [];

    // Collision callback — set externally. Fires for significant impacts only.
    this.onCollision = null;
    const dieBodySet = new Set(this.bodies);
    for (const body of this.bodies) {
      body.addEventListener('collide', (event) => {
        if (!this.onCollision) return;
        const speed = Math.abs(event.contact.getImpactVelocityAlongNormal?.() ?? 0);
        if (speed < 1.2) return;
        const otherIsDie = dieBodySet.has(event.body);
        const intensity = Math.min(1, speed / 8);
        this.onCollision({ kind: otherIsDie ? 'dice' : 'mat', intensity });
      });
    }
  }

  parkAll() {
    for (const b of this.bodies) {
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.position.set(20, -20, 0);
      b.sleep();
    }
    this.activeIndices = [];
  }

  // Throw the given dice indices. Other indices stay where they are (locked dice keep their place).
  throwDice(activeIndices, lockedTransforms = []) {
    this.activeIndices = activeIndices.slice();

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (activeIndices.includes(i)) {
        b.wakeUp();
        const startX = -5.5 + Math.random() * 1.0;
        const startY = 4.5 + Math.random() * 1.5;
        const startZ = -3 + Math.random() * 6;
        b.position.set(startX, startY, startZ);
        const e = new CANNON.Vec3(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        );
        b.quaternion.setFromEuler(e.x, e.y, e.z);
        b.velocity.set(
          7 + Math.random() * 4,
          1 + Math.random() * 2,
          (Math.random() - 0.5) * 4
        );
        b.angularVelocity.set(
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18
        );
      }
    }

    // Place locked dice at fixed positions on the right side of the table so they're visible
    const lockedRow = lockedTransforms.length;
    for (let j = 0; j < lockedTransforms.length; j++) {
      const t = lockedTransforms[j];
      const b = this.bodies[t.index];
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      // Spread locked dice along the bottom rim
      const xOffset = -3 + j * 1.4;
      b.position.set(xOffset, 0.5, 4.2);
      // Set quaternion so the kept value faces up
      const q = quaternionForFaceUp(t.value);
      b.quaternion.copy(q);
      b.sleep();
    }
  }

  step(dt) {
    const fixed = 1 / 60;
    this.world.step(fixed, dt, 3);
  }

  isSettled() {
    for (const i of this.activeIndices) {
      const b = this.bodies[i];
      const v = b.velocity.length();
      const w = b.angularVelocity.length();
      if (v > 0.05 || w > 0.05) return false;
    }
    return true;
  }

  getTransforms() {
    return this.bodies.map(b => [
      b.position.x, b.position.y, b.position.z,
      b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w,
    ]);
  }

  getFullSnapshot() {
    return this.bodies.map(b => ({
      pos: [b.position.x, b.position.y, b.position.z],
      quat: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
      vel: [b.velocity.x, b.velocity.y, b.velocity.z],
      angVel: [b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z],
    }));
  }

  getValues() {
    return this.bodies.map(b => readDieValue(b.quaternion));
  }

  getActiveValues() {
    return this.activeIndices.map(i => readDieValue(this.bodies[i].quaternion));
  }

  // Slight nudge if a die wedges against a wall vertically (prevents stuck-on-edge readings)
  unstickIfNeeded() {
    for (const i of this.activeIndices) {
      const b = this.bodies[i];
      // Check tilt: which axis is closest to up
      const value = readDieValue(b.quaternion);
      // pick the closest face's dot
      const up = new CANNON.Vec3(0, 1, 0);
      const axes = [
        new CANNON.Vec3( 1, 0, 0), new CANNON.Vec3(-1, 0, 0),
        new CANNON.Vec3( 0, 1, 0), new CANNON.Vec3( 0,-1, 0),
        new CANNON.Vec3( 0, 0, 1), new CANNON.Vec3( 0, 0,-1),
      ];
      let best = -Infinity;
      for (const a of axes) {
        const r = b.quaternion.vmult(a);
        const d = r.dot(up);
        if (d > best) best = d;
      }
      if (best < 0.92) {
        b.wakeUp();
        b.angularVelocity.set(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8
        );
        b.velocity.y = 2;
      }
    }
  }
}

import * as THREE from 'three';

// Build a quaternion that orients the die so the given face value points up (+Y).
// Inverse mapping of FACE_VALUES in dice.js: value -> local axis to rotate toward +Y.
const VALUE_TO_AXIS = {
  1: new THREE.Vector3( 1, 0, 0),
  6: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3( 0, 1, 0),
  5: new THREE.Vector3( 0,-1, 0),
  3: new THREE.Vector3( 0, 0, 1),
  4: new THREE.Vector3( 0, 0,-1),
};

function quaternionForFaceUp(value) {
  const localAxis = VALUE_TO_AXIS[value];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(localAxis, up);
  return new CANNON.Quaternion(q.x, q.y, q.z, q.w);
}
