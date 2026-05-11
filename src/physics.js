import * as CANNON from 'cannon-es';
import { readDieValue, readDieFaceAndAlignment } from './dice.js';

const STABLE_FRAMES_REQUIRED = 10; // ~167ms at 60fps
const FACE_UP_ALIGNMENT = 0.85;    // face normal · world up must exceed this

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
    addWall(0, -7.5,   0,  1);
    addWall(0,  7.5,   0, -1);
    addWall(-10.5, 0,  1,  0);
    addWall( 10.5, 0, -1,  0);

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

    // Item-effect state
    this.dookieZones = [];          // [{x, z, r}]
    this.iceRink = false;
    this._normalFriction = this.world.defaultContactMaterial.friction;
    this._iceFriction = 0.04;
    this.sawBladeIndex = -1;
    this._sawBladeTimer = 0;

    // Weighted dice — set of indices with continuous torque bias toward 1-up.
    this.weightedDice = new Set();
    this.weightedStrength = 2.8;

    // Per-die face stability tracker: index -> { value, stableFrames }.
    // A die is "stable" when its top face has been the same for >= STABLE_FRAMES_REQUIRED
    // consecutive frames AND its alignment with world-up is sufficient. This lets us
    // consider a sliding-on-ice die "settled" the moment its face stops changing.
    this._faceTracker = new Map();

    // Collision callback — set externally. Fires for significant impacts only.
    this.onCollision = null;
    const dieBodySet = new Set(this.bodies);
    for (const body of this.bodies) {
      const selfIdx = this.bodies.indexOf(body);
      body.addEventListener('collide', (event) => {
        const otherIsDie = dieBodySet.has(event.body);
        const otherIdx = otherIsDie ? this.bodies.indexOf(event.body) : -1;

        // Tornado kick — if this die IS the tornado and it hit another die,
        // hurl that die with a big random impulse + chaotic angular velocity.
        // Only the saw blade's listener applies the impulse (otherwise we'd
        // double-kick — every collision fires both bodies' listeners).
        if (otherIsDie && selfIdx === this.sawBladeIndex) {
          const victim = event.body;
          victim.wakeUp();
          // Launch the victim hard — let it fly. No vertical cap.
          victim.velocity.x += (Math.random() - 0.5) * 14;
          victim.velocity.z += (Math.random() - 0.5) * 14;
          victim.velocity.y += 4 + Math.random() * 5;
          victim.angularVelocity.x += (Math.random() - 0.5) * 35;
          victim.angularVelocity.y += (Math.random() - 0.5) * 35;
          victim.angularVelocity.z += (Math.random() - 0.5) * 35;
        }

        if (!this.onCollision) return;
        const speed = Math.abs(event.contact.getImpactVelocityAlongNormal?.() ?? 0);
        if (speed < 1.2) return;
        const intensity = Math.min(1, speed / 8);
        const ax = body.position.x, ay = body.position.y, az = body.position.z;
        const bx = event.body.position?.x ?? ax, by = event.body.position?.y ?? ay, bz = event.body.position?.z ?? az;
        const point = otherIsDie
          ? [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]
          : [ax, 0.1, az];
        this.onCollision({
          kind: otherIsDie ? 'dice' : 'mat',
          intensity,
          aIndex: selfIdx,
          bIndex: otherIdx,
          point,
        });
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
    this._faceTracker.clear();
  }

  parkIndices(indices) {
    for (const i of indices) {
      const b = this.bodies[i];
      b.collisionResponse = true; // ensure restored (in case the body was ghosted)
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.position.set(20 + i * 2, -20, 0);
      b.sleep();
      this._faceTracker.delete(i);
    }
  }

  // Portable Hole — turns off collision response on the die so gravity pulls
  // it straight through the felt. A small downward seed velocity makes the
  // fall start immediately and consistently.
  enterPortableHole(dieIndex) {
    const b = this.bodies[dieIndex];
    b.collisionResponse = false;
    b.wakeUp();
    b.velocity.set(0, -4, 0);
    b.angularVelocity.set(0, 0, 0);
  }

  // Restore parked dice to a default rest pose so they're visible again next roll.
  restoreParked(indices) {
    for (const i of indices) {
      const b = this.bodies[i];
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.position.set(-3 + i * 1.4, 0.5, 4.2);
      b.quaternion.set(0, 0, 0, 1);
      b.sleep();
    }
  }

  // ---- Item effects ----

  setDookieZones(zones) { this.dookieZones = zones || []; }

  setIceRink(on) {
    this.iceRink = !!on;
    // Slick — almost no contact friction, bouncy off walls, no velocity decay.
    this.world.defaultContactMaterial.friction = on ? 0.001 : this._normalFriction;
    this.world.defaultContactMaterial.restitution = on ? 0.78 : 0.22;
    for (const b of this.bodies) {
      b.linearDamping = on ? 0.0 : 0.08;
      b.angularDamping = on ? 0.0 : 0.12;
      b.sleepSpeedLimit = on ? 0.02 : 0.15;
      b.sleepTimeLimit = on ? 2.0 : 0.4;
    }
    if (on) {
      // If dice were already settled, give them a tiny shove so the slip is visible.
      for (const b of this.bodies) {
        if (b.position.y > -1) {
          b.wakeUp();
          if (b.velocity.length() < 0.05 && b.position.y < 1.5) {
            b.velocity.set(
              (Math.random() - 0.5) * 1.2,
              0,
              (Math.random() - 0.5) * 1.2,
            );
          }
        }
      }
    }
  }

  applyDookieDrag() {
    if (!this.dookieZones.length) return;
    for (const b of this.bodies) {
      for (const z of this.dookieZones) {
        const dx = b.position.x - z.x;
        const dz = b.position.z - z.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < z.r * z.r && b.position.y < 1.5) {
          b.wakeUp();
          // Sticky: heavy drag pulls die toward zone center and damps it
          b.velocity.x *= 0.7;
          b.velocity.z *= 0.7;
          b.angularVelocity.x *= 0.6;
          b.angularVelocity.y *= 0.6;
          b.angularVelocity.z *= 0.6;
          b.velocity.x -= dx * 1.2;
          b.velocity.z -= dz * 1.2;
        }
      }
    }
  }

  // Flick a die. If hitPoint is provided, the impulse direction is "into" the die
  // at that point — the die flies in the opposite direction of the click, like a real flick.
  // Flicks are 4x more powerful on the ice rink (less friction + bigger impulse).
  flickDie(dieIndex, hitPoint = null) {
    const b = this.bodies[dieIndex];
    b.wakeUp();
    const mult = this.iceRink ? 4 : 1;
    let vx, vy, vz;
    if (hitPoint) {
      const dx = hitPoint[0] - b.position.x;
      const dy = hitPoint[1] - b.position.y;
      const dz = hitPoint[2] - b.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const force = 9 * mult;
      // Push die away from the hit point.
      vx = -(dx / len) * force;
      vy = Math.max(2.5, -(dy / len) * force * 0.6 + 3);
      vz = -(dz / len) * force;
      const ax = (Math.random() - 0.5) * 14 * mult;
      const ay = (Math.random() - 0.5) * 14 * mult;
      const az = (Math.random() - 0.5) * 14 * mult;
      b.angularVelocity.set(ax, ay, az);
    } else {
      vx = (Math.random() - 0.5) * 5 * mult;
      vy = 4.5 + Math.random() * 1.5;
      vz = (Math.random() - 0.5) * 5 * mult;
      b.angularVelocity.set(
        (Math.random() - 0.5) * 22 * mult,
        (Math.random() - 0.5) * 22 * mult,
        (Math.random() - 0.5) * 22 * mult,
      );
    }
    b.velocity.set(vx, vy, vz);
    if (!this.activeIndices.includes(dieIndex)) this.activeIndices.push(dieIndex);
  }

  startSawBlade(dieIndex) {
    this.sawBladeIndex = dieIndex;
    this._sawBladeTimer = 0;
    const b = this.bodies[dieIndex];
    b.wakeUp();
    // 2x the original lateral speed, almost no lift — stays on the table.
    b.velocity.set((Math.random() - 0.5) * 12, 0.6, (Math.random() - 0.5) * 12);
    b.angularVelocity.set(0, 76, 0);
    if (!this.activeIndices.includes(dieIndex)) this.activeIndices.push(dieIndex);
  }

  tickSawBlade(dieIndex, dt) {
    const b = this.bodies[dieIndex];
    b.wakeUp();
    // Single-axis spin (vertical only). Damp out any horizontal angular
    // velocity it picks up from collisions so it doesn't tumble or get lift.
    b.angularVelocity.y = 76;
    b.angularVelocity.x *= 0.6;
    b.angularVelocity.z *= 0.6;
    // 2x the original cadence/strength of lateral impulses, no vertical kick.
    this._sawBladeTimer += dt;
    if (this._sawBladeTimer > 0.09) {
      this._sawBladeTimer = 0;
      b.velocity.x += (Math.random() - 0.5) * 14;
      b.velocity.z += (Math.random() - 0.5) * 14;
      // Damp any upward velocity gained from bouncing — keep it grounded.
      if (b.velocity.y > 1.5) b.velocity.y = 1.5;
    }
  }

  endSawBlade(dieIndex) {
    this.sawBladeIndex = -1;
    const b = this.bodies[dieIndex];
    // Damp it so the regular settle path can engage and pick up everyone's resting values.
    b.velocity.scale(0.3, b.velocity);
    b.angularVelocity.scale(0.3, b.angularVelocity);
    // Promote all dice back to settle-tracking so onSettle reads everyone correctly.
    this.activeIndices = this.bodies.map((_, i) => i);
  }

  setDieWeightedTowardOne(dieIndex, on) {
    if (on) this.weightedDice.add(dieIndex);
    else this.weightedDice.delete(dieIndex);
  }

  clearWeightedDice() {
    this.weightedDice.clear();
  }

  // Each step, nudge every weighted die's local +X axis (the "1" face) toward world up.
  // Crucially the torque only fires while the die has real momentum — once it's
  // slowing down it gets left alone so settle detection can fire normally. Without
  // this gate, the constant nudge keeps the die above the settle velocity threshold
  // and it never comes to rest. Strong spin still overpowers the bias mid-roll.
  applyWeightedTorques() {
    if (!this.weightedDice.size) return;
    const up = new CANNON.Vec3(0, 1, 0);
    const localOneAxis = new CANNON.Vec3(1, 0, 0);
    const worldOneAxis = new CANNON.Vec3();
    for (const idx of this.weightedDice) {
      const b = this.bodies[idx];
      if (b.sleepState === CANNON.Body.SLEEPING) continue;
      const motion = b.velocity.length() + b.angularVelocity.length();
      if (motion < 0.4) continue; // give settle a chance — no torque on near-still dice
      b.quaternion.vmult(localOneAxis, worldOneAxis);
      const torque = worldOneAxis.cross(up);
      torque.scale(this.weightedStrength, torque);
      b.applyTorque(torque);
    }
  }

  // Force a die to show a specific face value while at rest.
  setDieFaceUp(dieIndex, value) {
    const b = this.bodies[dieIndex];
    const q = quaternionForFaceUp(value);
    b.quaternion.copy(q);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.sleep();
  }

  // Throw the given dice indices. Other indices stay where they are (locked dice keep their place).
  throwDice(activeIndices, lockedTransforms = []) {
    this.activeIndices = activeIndices.slice();
    // Clear face tracker for thrown dice so they have to re-stabilize from scratch.
    for (const i of activeIndices) this._faceTracker.delete(i);

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

  // A die is "settled" when its top face has been the same for a few consecutive
  // frames AND that face is roughly aligned with world up — regardless of whether
  // the die is still sliding (e.g. on an ice rink).
  updateFaceTracker() {
    for (const i of this.activeIndices) {
      const b = this.bodies[i];
      const { value, alignment } = readDieFaceAndAlignment(b.quaternion);
      const prev = this._faceTracker.get(i);
      const aligned = alignment >= FACE_UP_ALIGNMENT;
      if (prev && prev.value === value && aligned) {
        this._faceTracker.set(i, { value, alignment, stableFrames: prev.stableFrames + 1 });
      } else {
        this._faceTracker.set(i, { value, alignment, stableFrames: aligned ? 1 : 0 });
      }
    }
  }

  isSettled() {
    for (const i of this.activeIndices) {
      const entry = this._faceTracker.get(i);
      if (!entry || entry.stableFrames < STABLE_FRAMES_REQUIRED) return false;
      // Also require the die isn't still rotating in a flip-causing direction.
      // We allow vertical spin (around world up) so an ice-spun die that's flat
      // can still settle without dragging on forever, but reject any meaningful
      // horizontal angular velocity — that would tip the face over soon.
      const w = this.bodies[i].angularVelocity;
      const wHoriz = Math.sqrt(w.x * w.x + w.z * w.z);
      if (wHoriz > 1.0) return false;
    }
    return true;
  }

  // Per-die snapshot used during awaiting_keep to detect mid-keep disturbances.
  getFaceStates() {
    const out = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const entry = this._faceTracker.get(i);
      if (entry) {
        out.push({ value: entry.value, stable: entry.stableFrames >= STABLE_FRAMES_REQUIRED });
      } else {
        const { value, alignment } = readDieFaceAndAlignment(this.bodies[i].quaternion);
        out.push({ value, stable: alignment >= FACE_UP_ALIGNMENT });
      }
    }
    return out;
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

  // Gentle nudge applied to active dice that are taking a while to settle.
  // Two cases: stuck-tilted gets a small kick to fall flat; flat-but-spinning
  // gets its horizontal angular velocity damped so the face-stability check fires.
  unstickIfNeeded() {
    const up = new CANNON.Vec3(0, 1, 0);
    const axes = [
      new CANNON.Vec3( 1, 0, 0), new CANNON.Vec3(-1, 0, 0),
      new CANNON.Vec3( 0, 1, 0), new CANNON.Vec3( 0,-1, 0),
      new CANNON.Vec3( 0, 0, 1), new CANNON.Vec3( 0, 0,-1),
    ];
    for (const i of this.activeIndices) {
      const b = this.bodies[i];
      let best = -Infinity;
      for (const a of axes) {
        const r = b.quaternion.vmult(a);
        const d = r.dot(up);
        if (d > best) best = d;
      }
      if (best < 0.9) {
        b.wakeUp();
        b.angularVelocity.x += (Math.random() - 0.5) * 4;
        b.angularVelocity.y += (Math.random() - 0.5) * 4;
        b.angularVelocity.z += (Math.random() - 0.5) * 4;
        b.velocity.y = Math.max(b.velocity.y, 1.2);
      } else {
        // Already flat-ish — just damp horizontal spin so it can stabilize.
        b.angularVelocity.x *= 0.35;
        b.angularVelocity.z *= 0.35;
        b.velocity.x *= 0.85;
        b.velocity.z *= 0.85;
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
