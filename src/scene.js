import * as THREE from 'three';
import { createDieMesh } from './dice.js';

export class Scene {
  constructor(rootEl) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rootEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 9.5, 8.5);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xb8c6df, 0x0a0f18, 0.55);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff0d6, 1.2);
    dir.position.set(5, 11, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -9;
    dir.shadow.camera.right = 9;
    dir.shadow.camera.top = 9;
    dir.shadow.camera.bottom = -9;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 30;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);

    const tableGeom = new THREE.PlaneGeometry(14, 10);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x1a4d2e, roughness: 0.9, metalness: 0 });
    const table = new THREE.Mesh(tableGeom, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x3b2515, roughness: 0.6 });
    const addRim = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    addRim(14.6, 0.5, 0.4,  0, 0.25,  5.2);
    addRim(14.6, 0.5, 0.4,  0, 0.25, -5.2);
    addRim(0.4, 0.5, 10.8,  7.3, 0.25, 0);
    addRim(0.4, 0.5, 10.8, -7.3, 0.25, 0);

    this.dieMeshes = [];
    this.selectionRings = [];
    for (let i = 0; i < 5; i++) {
      const m = createDieMesh();
      m.visible = false;
      this.scene.add(m);
      this.dieMeshes.push(m);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.82, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      ring.visible = false;
      this.scene.add(ring);
      this.selectionRings.push(ring);

      const lockRing = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.82, 28),
        new THREE.MeshBasicMaterial({ color: 0x7cf3a0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
      );
      lockRing.rotation.x = -Math.PI / 2;
      lockRing.position.y = 0.01;
      lockRing.visible = false;
      this.scene.add(lockRing);
      this.dieMeshes[i].userData.lockRing = lockRing;
    }

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    window.addEventListener('resize', () => this.onResize());
    this.tickCallbacks = [];
    this.lastTime = performance.now();
    this.start();
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  onTick(cb) { this.tickCallbacks.push(cb); }

  setDieTransform(i, pos, quat, visible = true) {
    const m = this.dieMeshes[i];
    const offstage = pos[1] < -5;
    m.visible = visible && !offstage;
    m.position.set(pos[0], pos[1], pos[2]);
    m.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    const sel = this.selectionRings[i];
    sel.position.x = pos[0];
    sel.position.z = pos[2];
    if (offstage) sel.visible = false;
    const lock = m.userData.lockRing;
    lock.position.x = pos[0];
    lock.position.z = pos[2];
    if (offstage) lock.visible = false;
  }

  setSelected(i, selected) {
    if (this.dieMeshes[i].visible) this.selectionRings[i].visible = selected;
  }
  setLocked(i, locked) {
    if (this.dieMeshes[i].visible) this.dieMeshes[i].userData.lockRing.visible = locked;
    else this.dieMeshes[i].userData.lockRing.visible = false;
  }

  hideAllDice() {
    for (let i = 0; i < this.dieMeshes.length; i++) {
      this.dieMeshes[i].visible = false;
      this.selectionRings[i].visible = false;
      this.dieMeshes[i].userData.lockRing.visible = false;
    }
  }

  pickDie(clientX, clientY) {
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visible = this.dieMeshes.filter(m => m.visible);
    const hits = this.raycaster.intersectObjects(visible, false);
    if (hits.length === 0) return -1;
    return this.dieMeshes.indexOf(hits[0].object);
  }

  start() {
    const loop = (now) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      for (const cb of this.tickCallbacks) cb(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
