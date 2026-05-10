import * as THREE from 'three';
import { createDieMesh } from './dice.js';
import { woodTexture, feltTexture, bumpFrom } from './textures.js';

export class Scene {
  constructor(rootEl) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    rootEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 9.5, 8.5);
    this.camera.lookAt(0, 0, 0);

    // Subtle ambient hemisphere — cool sky, warm ground bounce
    const hemi = new THREE.HemisphereLight(0xb8c6df, 0x382010, 0.35);
    this.scene.add(hemi);

    // Key light — overhead casino spot, warm
    const key = new THREE.DirectionalLight(0xfff0c8, 1.05);
    key.position.set(4, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 3;
    this.scene.add(key);

    // Fill — cool counter-light from opposite side
    const fill = new THREE.DirectionalLight(0x6a8cff, 0.25);
    fill.position.set(-6, 8, -4);
    this.scene.add(fill);

    // Warm accent rim spotlight on the table to add casino mood
    const accent = new THREE.SpotLight(0xff9b3d, 0.85, 18, Math.PI / 4, 0.55, 1.2);
    accent.position.set(0, 7, 0);
    accent.target.position.set(0, 0, 0);
    this.scene.add(accent);
    this.scene.add(accent.target);

    // Soft red & blue side neon-ish accents (no shadow contribution)
    const neonRed = new THREE.PointLight(0xff3050, 0.5, 12);
    neonRed.position.set(-7, 1.5, -4);
    this.scene.add(neonRed);
    const neonBlue = new THREE.PointLight(0x4a6cff, 0.45, 12);
    neonBlue.position.set(7, 1.5, 4);
    this.scene.add(neonBlue);

    // ----- Table felt -----
    const felt = feltTexture();
    felt.repeat.set(2, 1.4);
    const feltBump = bumpFrom(felt);
    const tableGeom = new THREE.PlaneGeometry(14, 10);
    const tableMat = new THREE.MeshPhysicalMaterial({
      map: felt,
      bumpMap: feltBump,
      bumpScale: 0.04,
      roughness: 0.95,
      metalness: 0,
      sheen: 0.4,
      sheenColor: new THREE.Color(0x2a7048),
      sheenRoughness: 0.85,
    });
    const table = new THREE.Mesh(tableGeom, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    // ----- Wooden rim -----
    const wood = woodTexture();
    const woodLong = wood.clone();
    woodLong.repeat.set(3, 0.3);
    const woodShort = wood.clone();
    woodShort.repeat.set(2.2, 0.3);
    const rimMatLong = new THREE.MeshPhysicalMaterial({
      map: woodLong, bumpMap: bumpFrom(woodLong), bumpScale: 0.05,
      roughness: 0.55, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.5,
    });
    const rimMatShort = new THREE.MeshPhysicalMaterial({
      map: woodShort, bumpMap: bumpFrom(woodShort), bumpScale: 0.05,
      roughness: 0.55, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.5,
    });
    const addRim = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    addRim(14.6, 0.5, 0.4,  0, 0.25,  5.2, rimMatLong);
    addRim(14.6, 0.5, 0.4,  0, 0.25, -5.2, rimMatLong);
    addRim(0.4, 0.5, 10.8,  7.3, 0.25, 0, rimMatShort);
    addRim(0.4, 0.5, 10.8, -7.3, 0.25, 0, rimMatShort);

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

    // Track table material so we can swap to ice when items activate.
    this._table = table;
    this._feltMat = tableMat;
    const iceTex = feltTexture({ width: 1024, height: 1024 });
    this._iceMat = new THREE.MeshPhysicalMaterial({
      color: 0xa9d4ff,
      map: null,
      bumpMap: bumpFrom(iceTex),
      bumpScale: 0.02,
      roughness: 0.18,
      metalness: 0.05,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
      emissive: 0x1a3a55,
      emissiveIntensity: 0.18,
    });

    // Container for dookie blob meshes
    this._dookieMeshes = new Map(); // key -> mesh

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

  setSelected(i, selected, color = 0xffe07a) {
    if (this.dieMeshes[i].visible) {
      this.selectionRings[i].visible = selected;
      this.selectionRings[i].material.color.setHex(color);
    }
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

  setIceRink(on) {
    this._table.material = on ? this._iceMat : this._feltMat;
    this._table.material.needsUpdate = true;
  }

  syncDookieZones(zones) {
    const want = new Set(zones.map(z => `${z.x.toFixed(2)}:${z.z.toFixed(2)}`));
    // Remove gone
    for (const [key, mesh] of [...this._dookieMeshes.entries()]) {
      if (!want.has(key)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this._dookieMeshes.delete(key);
      }
    }
    // Add new
    for (const z of zones) {
      const key = `${z.x.toFixed(2)}:${z.z.toFixed(2)}`;
      if (this._dookieMeshes.has(key)) continue;
      const geom = new THREE.SphereGeometry(z.r * 0.55, 14, 10);
      // Squash to a blob shape
      geom.scale(1, 0.45, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4a2a10,
        roughness: 0.9,
        metalness: 0.0,
      });
      const m = new THREE.Mesh(geom, mat);
      m.position.set(z.x, 0.15, z.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this._dookieMeshes.set(key, m);

      // Tiny 'flies' cloud above (a few black dots)
      for (let f = 0; f < 4; f++) {
        const fly = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0x000000 }),
        );
        fly.position.set(
          z.x + (Math.random() - 0.5) * z.r * 0.6,
          0.5 + Math.random() * 0.3,
          z.z + (Math.random() - 0.5) * z.r * 0.6,
        );
        m.add(fly);
        fly.position.sub(m.position);
      }
    }
  }

  hideDie(i) { this.dieMeshes[i].visible = false; this.selectionRings[i].visible = false; this.dieMeshes[i].userData.lockRing.visible = false; }

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
