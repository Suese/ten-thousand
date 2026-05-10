import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createDieMesh } from './dice.js';
import { woodTexture, feltTexture, iceTexture, bumpFrom } from './textures.js';

// Casino-themed environment scene used to bake an IBL cubemap.
// Starts from three.js's built-in RoomEnvironment (a well-tuned procedural
// interior that gives any PBR material a reasonable base reflection) and
// layers casino accents on top — warm overhead chandelier, burgundy
// "curtains," gold corner sconces, neon strips, and four bright bulbs.
function casinoEnvironmentScene() {
  const env = new RoomEnvironment();

  const addAccent = (color, intensity, x, y, z, w, h, d) => {
    const mat = new THREE.MeshBasicMaterial({ color });
    mat.color.multiplyScalar(intensity);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    env.add(m);
  };

  // RoomEnvironment is roughly a 20-unit cube. Place accents inside that volume.
  // Warm overhead chandelier glow
  addAccent(0xffd070, 3.5,   0,  8,   0,  9, 0.3,  9);

  // Burgundy "curtains" — deep red panels behind walls give a casino backdrop
  addAccent(0x8c0a1f, 0.8,   0,  0, -9.5, 18, 9, 0.3);
  addAccent(0x8c0a1f, 0.8,   0,  0,  9.5, 18, 9, 0.3);
  addAccent(0x8c0a1f, 0.8, -9.5, 0,   0, 0.3, 9, 18);
  addAccent(0x8c0a1f, 0.8,  9.5, 0,   0, 0.3, 9, 18);

  // Gold corner sconces — sharp warm highlights on chrome / gold dice
  addAccent(0xffb040, 6, -8, 4, -8, 0.7, 0.7, 0.7);
  addAccent(0xffb040, 6,  8, 4, -8, 0.7, 0.7, 0.7);
  addAccent(0xffb040, 6, -8, 4,  8, 0.7, 0.7, 0.7);
  addAccent(0xffb040, 6,  8, 4,  8, 0.7, 0.7, 0.7);

  // Neon strips — multi-coloured reflections for the glassy dice
  addAccent(0x4060ff, 4,   0, 5, -8.7, 5, 0.2, 0.2);
  addAccent(0xff60a0, 4, -8.7, 5,   0, 0.2, 0.2, 5);
  addAccent(0x60ffaa, 4,  8.7, 5,   0, 0.2, 0.2, 5);
  addAccent(0xffd070, 4,   0, 5,  8.7, 5, 0.2, 0.2);

  // Bright pinpoint bulbs — give the gold dice tight specular sparkles
  addAccent(0xffffff, 10, -5, 7, -5, 0.4, 0.4, 0.4);
  addAccent(0xffffff, 10,  5, 7, -5, 0.4, 0.4, 0.4);
  addAccent(0xffffff, 10, -5, 7,  5, 0.4, 0.4, 0.4);
  addAccent(0xffffff, 10,  5, 7,  5, 0.4, 0.4, 0.4);

  return env;
}

// Chamfered (bevel-edged) box geometry. Generalises the chamfered cube used for
// the dice — 6 face quads + 12 edge bevel quads + 8 corner bevel triangles.
function createChamferedBoxGeometry(w, h, d, chamfer = 0.06) {
  const sx = w / 2, sy = h / 2, sz = d / 2;
  const ex = sx - chamfer, ey = sy - chamfer, ez = sz - chamfer;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let n = 0;

  function quad(verts, normal) {
    const start = n;
    for (let i = 0; i < 4; i++) {
      positions.push(...verts[i]);
      normals.push(...normal);
      uvs.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
      n++;
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function tri(verts, normal) {
    const start = n;
    for (let i = 0; i < 3; i++) {
      positions.push(...verts[i]);
      normals.push(...normal);
      uvs.push(0.5, 0.5);
      n++;
    }
    indices.push(start, start + 1, start + 2);
  }

  // Six face quads
  quad([[ sx,-ey,-ez], [ sx, ey,-ez], [ sx, ey, ez], [ sx,-ey, ez]], [ 1, 0, 0]);
  quad([[-sx,-ey, ez], [-sx, ey, ez], [-sx, ey,-ez], [-sx,-ey,-ez]], [-1, 0, 0]);
  quad([[-ex, sy, ez], [ ex, sy, ez], [ ex, sy,-ez], [-ex, sy,-ez]], [ 0, 1, 0]);
  quad([[-ex,-sy,-ez], [ ex,-sy,-ez], [ ex,-sy, ez], [-ex,-sy, ez]], [ 0,-1, 0]);
  quad([[-ex,-ey, sz], [ ex,-ey, sz], [ ex, ey, sz], [-ex, ey, sz]], [ 0, 0, 1]);
  quad([[ ex,-ey,-sz], [-ex,-ey,-sz], [-ex, ey,-sz], [ ex, ey,-sz]], [ 0, 0,-1]);

  const norm2 = (a, b) => { const l = Math.hypot(a, b); return [a / l, b / l]; };
  const norm3 = (a, b, c) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; };

  // 12 edge bevels (winding chosen to face outward — same pattern as the dice).
  const edges = [
    // Z-axis edges
    { q: [[ sx,  ey, -ez], [ ex,  sy, -ez], [ ex,  sy,  ez], [ sx,  ey,  ez]], n: [...norm2( 1,  1), 0] },
    { q: [[ ex, -sy, -ez], [ sx, -ey, -ez], [ sx, -ey,  ez], [ ex, -sy,  ez]], n: [...norm2( 1, -1), 0] },
    { q: [[-ex,  sy, -ez], [-sx,  ey, -ez], [-sx,  ey,  ez], [-ex,  sy,  ez]], n: [...norm2(-1,  1), 0] },
    { q: [[-sx, -ey, -ez], [-ex, -sy, -ez], [-ex, -sy,  ez], [-sx, -ey,  ez]], n: [...norm2(-1, -1), 0] },
    // X-axis edges
    { q: [[-ex,  sy,  ez], [-ex,  ey,  sz], [ ex,  ey,  sz], [ ex,  sy,  ez]], n: [0, ...norm2( 1,  1)] },
    { q: [[ ex,  sy, -ez], [ ex,  ey, -sz], [-ex,  ey, -sz], [-ex,  sy, -ez]], n: [0, ...norm2( 1, -1)] },
    { q: [[ ex, -sy,  ez], [ ex, -ey,  sz], [-ex, -ey,  sz], [-ex, -sy,  ez]], n: [0, ...norm2(-1,  1)] },
    { q: [[-ex, -sy, -ez], [-ex, -ey, -sz], [ ex, -ey, -sz], [ ex, -sy, -ez]], n: [0, ...norm2(-1, -1)] },
    // Y-axis edges
    { q: [[ sx, -ey,  ez], [ sx,  ey,  ez], [ ex,  ey,  sz], [ ex, -ey,  sz]], n: [norm2( 1,  1)[0], 0, norm2( 1,  1)[1]] },
    { q: [[ sx,  ey, -ez], [ sx, -ey, -ez], [ ex, -ey, -sz], [ ex,  ey, -sz]], n: [norm2( 1, -1)[0], 0, norm2( 1, -1)[1]] },
    { q: [[-ex,  ey,  sz], [-sx,  ey,  ez], [-sx, -ey,  ez], [-ex, -ey,  sz]], n: [norm2(-1,  1)[0], 0, norm2(-1,  1)[1]] },
    { q: [[-ex, -ey, -sz], [-sx, -ey, -ez], [-sx,  ey, -ez], [-ex,  ey, -sz]], n: [norm2(-1, -1)[0], 0, norm2(-1, -1)[1]] },
  ];
  for (const ed of edges) quad(ed.q, ed.n);

  // 8 corner bevel triangles
  const corners = [
    [ 1,  1,  1], [ 1,  1, -1], [ 1, -1,  1], [ 1, -1, -1],
    [-1,  1,  1], [-1,  1, -1], [-1, -1,  1], [-1, -1, -1],
  ];
  for (const [csx, csy, csz] of corners) {
    const v0 = [csx * sx, csy * ey, csz * ez];
    const v1 = [csx * ex, csy * sy, csz * ez];
    const v2 = [csx * ex, csy * ey, csz * sz];
    const order = (csx * csy * csz > 0) ? [v0, v1, v2] : [v0, v2, v1];
    tri(order, norm3(csx, csy, csz));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

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

    // ----- Casino environment map (image-based lighting) -----
    // Bake the casino-themed mini-scene into a cubemap; PBR materials (gold
    // dice, glassy dice, the wood rim) will pick up its colored reflections.
    {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = casinoEnvironmentScene();
      const envRT = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = 0.65;
      pmrem.dispose();
    }

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 14.25, 12.75);
    this.camera.lookAt(0, 0, 0);

    // Subtle ambient hemisphere — cool sky, warm ground bounce
    const hemi = new THREE.HemisphereLight(0xb8c6df, 0x382010, 0.35);
    this.scene.add(hemi);

    // Key light — overhead casino spot, warm
    const key = new THREE.DirectionalLight(0xfff0c8, 1.05);
    key.position.set(4, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
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

    // ----- Table felt — slightly larger than the rim's inner hole so it tucks
    // under the wood, and depth-offset so the dice (resting at y=0) don't z-fight.
    // Table is 1.5x the original scale.
    const felt = feltTexture();
    const feltBump = bumpFrom(felt);
    const tableGeom = new THREE.PlaneGeometry(22.5, 16.5);
    const tableMat = new THREE.MeshPhysicalMaterial({
      map: felt,
      bumpMap: feltBump,
      bumpScale: 0.04,
      roughness: 0.95,
      metalness: 0,
      sheen: 0.4,
      sheenColor: new THREE.Color(0x2a7048),
      sheenRoughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const table = new THREE.Mesh(tableGeom, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.002;
    table.receiveShadow = true;
    this.scene.add(table);

    // ----- Wooden rim — single picture-frame mesh, beveled, no z-fighting -----
    const wood = woodTexture();
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(2, 2);
    const rimMat = new THREE.MeshPhysicalMaterial({
      map: wood,
      bumpMap: bumpFrom(wood),
      bumpScale: 0.06,
      roughness: 0.5, metalness: 0.06,
      clearcoat: 0.45, clearcoatRoughness: 0.45,
    });

    // 1.5x the original — bigger casino table feel.
    const FELT_W = 21, FELT_D = 15;                 // inner hole; matches play area (cannon walls)
    const FRAME_W = 26.1, FRAME_D = 20.1;          // outer dimensions
    const FRAME_HEIGHT = 1.05;                      // unchanged height for proportion
    const frameShape = new THREE.Shape();
    frameShape.moveTo(-FRAME_W / 2, -FRAME_D / 2);
    frameShape.lineTo( FRAME_W / 2, -FRAME_D / 2);
    frameShape.lineTo( FRAME_W / 2,  FRAME_D / 2);
    frameShape.lineTo(-FRAME_W / 2,  FRAME_D / 2);
    frameShape.lineTo(-FRAME_W / 2, -FRAME_D / 2);
    const frameHole = new THREE.Path();
    frameHole.moveTo(-FELT_W / 2, -FELT_D / 2);
    frameHole.lineTo( FELT_W / 2, -FELT_D / 2);
    frameHole.lineTo( FELT_W / 2,  FELT_D / 2);
    frameHole.lineTo(-FELT_W / 2,  FELT_D / 2);
    frameHole.lineTo(-FELT_W / 2, -FELT_D / 2);
    frameShape.holes.push(frameHole);
    const frameGeom = new THREE.ExtrudeGeometry(frameShape, {
      depth: FRAME_HEIGHT,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.14,
      bevelOffset: 0,
      bevelSegments: 5,
      curveSegments: 1,
    });
    frameGeom.rotateX(-Math.PI / 2);
    const frame = new THREE.Mesh(frameGeom, rimMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.scene.add(frame);

    // ----- Casino carpet (loaded async; placeholder dark grey until image arrives) -----
    const carpetGeom = new THREE.PlaneGeometry(60, 45);
    const carpetMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f28,
      roughness: 0.96,
      metalness: 0.0,
    });
    const carpet = new THREE.Mesh(carpetGeom, carpetMat);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.y = -1.88;
    carpet.receiveShadow = true;
    this.scene.add(carpet);
    this._carpet = carpet;

    const carpetLoader = new THREE.TextureLoader();
    carpetLoader.load(
      './carpet.png',
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(8, 6);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        carpetMat.map = tex;
        carpetMat.color.setHex(0xffffff);
        carpetMat.needsUpdate = true;
      },
      undefined,
      () => {/* no carpet.png present, keep placeholder */},
    );

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
    const iceTex = iceTexture();
    this._iceMat = new THREE.MeshPhysicalMaterial({
      map: iceTex,
      bumpMap: bumpFrom(iceTex),
      bumpScale: 0.06,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 0.95,
      clearcoatRoughness: 0.06,
      emissive: 0x1a3a55,
      emissiveIntensity: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this._logoImage = null;

    // Container for dookie blob meshes
    this._dookieMeshes = new Map(); // key -> mesh

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Camera target tracking (lerps toward an interest point — usually the dice cluster).
    this._camBase = this.camera.position.clone();
    this._camLook = new THREE.Vector3(0, 0, 0);
    this._camLookTarget = new THREE.Vector3(0, 0, 0);
    // Mouse parallax — pointer position normalized to [-1, 1] on each axis.
    this._mouseNX = 0;
    this._mouseNY = 0;
    this._mouseX = 0;
    this._mouseY = 0;
    window.addEventListener('mousemove', (e) => {
      this._mouseNX = (e.clientX / window.innerWidth) * 2 - 1;
      this._mouseNY = (e.clientY / window.innerHeight) * 2 - 1;
    });

    window.addEventListener('resize', () => this.onResize());
    this.tickCallbacks = [];
    this.lastTime = performance.now();
    this._t = 0;
    this.start();
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  onTick(cb) { this.tickCallbacks.push(cb); }

  setDieTransform(i, pos, quat, visible = true) {
    // Skip if an animation is currently driving this die's transform (e.g. portable hole drop).
    if (this._animationOverrides && this._animationOverrides.has(i)) return;
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

  // Returns the screen-space [x, y] for a given 3D world point using this scene's camera.
  worldToScreen(point) {
    const v = new THREE.Vector3(point[0], point[1], point[2]);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // Portable Hole — spawns a black disc on the table at `worldPos`, then drops
  // the targeted die into it (visually). The die mesh is animated locally;
  // transforms for that index are blocked while the override is active so the
  // host's eventual park-to-offstage doesn't yank the die during the drop.
  playPortableHoleAnimation(dieIndex, worldPos) {
    if (!this._animationOverrides) this._animationOverrides = new Set();
    this._animationOverrides.add(dieIndex);

    const dieMesh = this.dieMeshes[dieIndex];
    const sel = this.selectionRings[dieIndex];
    const lock = dieMesh.userData.lockRing;
    sel.visible = false;
    lock.visible = false;

    // Black hole disc on the table surface.
    const discGeom = new THREE.CircleGeometry(0.9, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeom, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(worldPos[0], 0.03, worldPos[2]);
    disc.scale.setScalar(0.05);
    disc.renderOrder = 2;
    this.scene.add(disc);

    // Pin the die at the disc's xz so the fall looks centered.
    const startY = dieMesh.position.y;
    dieMesh.position.set(worldPos[0], startY, worldPos[2]);

    const start = performance.now();
    const duration = 1050;
    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);

      // Disc grows quickly, holds, then shrinks at the end.
      let discScale;
      if (t < 0.18) discScale = t / 0.18;
      else if (t > 0.88) discScale = (1 - t) / 0.12;
      else discScale = 1;
      disc.scale.setScalar(0.2 + 1.1 * Math.max(0, Math.min(1, discScale)));
      discMat.opacity = 0.92 * Math.max(0, Math.min(1, discScale * 1.5));

      // Die drops into the hole, rotating and shrinking until invisible.
      if (t > 0.18) {
        const phase = Math.min(1, (t - 0.18) / 0.72);
        const eased = phase * phase * (3 - 2 * phase); // smoothstep
        dieMesh.position.y = startY - eased * 1.8;
        dieMesh.rotation.y += 0.18;
        const s = 1 - eased * 0.95;
        dieMesh.scale.setScalar(Math.max(0.05, s));
        if (eased > 0.96) dieMesh.visible = false;
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Cleanup; release the transform lock so subsequent transforms (host has
        // parked the die offstage by now) take over and reset scale.
        this.scene.remove(disc);
        discGeom.dispose();
        discMat.dispose();
        dieMesh.scale.setScalar(1);
        this._animationOverrides.delete(dieIndex);
      }
    };
    requestAnimationFrame(animate);
  }

  setSelected(i, selected, color = 0xffe07a) {
    if (this.dieMeshes[i].visible) {
      this.selectionRings[i].visible = selected;
      this.selectionRings[i].material.color.setHex(color);
    }
  }

  setDieWeighted(i, on) {
    const m = this.dieMeshes[i];
    const target = on ? m.userData.materialsGold : m.userData.materialsRed;
    if (target && m.material !== target) m.material = target;
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
    if (hits.length === 0) return { index: -1, point: null };
    const idx = this.dieMeshes.indexOf(hits[0].object);
    const p = hits[0].point;
    return { index: idx, point: [p.x, p.y, p.z] };
  }

  // Returns {x, z} on the table plane (y=0) at the given screen coords, or null if outside the felt.
  pickTablePoint(clientX, clientY) {
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    if (hit.x < -7 || hit.x > 7 || hit.z < -5 || hit.z > 5) return null;
    return { x: hit.x, z: hit.z };
  }

  setIceRink(on) {
    this._table.material = on ? this._iceMat : this._feltMat;
    this._table.material.needsUpdate = true;
  }

  // Bake a logo image (HTMLImageElement) into both felt and ice canvas textures.
  // Re-runs the procedural texture generators with the image so the logo reads as
  // part of the surface (felt fibers cross over it, skate scratches cross over it).
  applyLogoImage(image) {
    if (!image) return;
    this._logoImage = image;

    const newFelt = feltTexture({}, image);
    const newFeltBump = bumpFrom(newFelt);
    if (this._feltMat.map) this._feltMat.map.dispose();
    if (this._feltMat.bumpMap) this._feltMat.bumpMap.dispose();
    this._feltMat.map = newFelt;
    this._feltMat.bumpMap = newFeltBump;
    this._feltMat.needsUpdate = true;

    const newIce = iceTexture({}, image);
    const newIceBump = bumpFrom(newIce);
    if (this._iceMat.map) this._iceMat.map.dispose();
    if (this._iceMat.bumpMap) this._iceMat.bumpMap.dispose();
    this._iceMat.map = newIce;
    this._iceMat.bumpMap = newIceBump;
    this._iceMat.needsUpdate = true;
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

  // Compute a "subject" point — the average position of visible dice on the table.
  // Falls back to the table center when no dice are visible. Also returns the
  // horizontal spread of the dice (used to drive the subtle zoom).
  _computeSubject(target) {
    let count = 0;
    target.set(0, 0, 0);
    for (const m of this.dieMeshes) {
      if (!m.visible) continue;
      if (m.position.y < -1) continue;
      target.x += m.position.x;
      target.y += m.position.y;
      target.z += m.position.z;
      count++;
    }
    if (count > 0) target.divideScalar(count);
    let spread = 0;
    for (const m of this.dieMeshes) {
      if (!m.visible || m.position.y < -1) continue;
      const dx = m.position.x - target.x;
      const dz = m.position.z - target.z;
      spread = Math.max(spread, Math.hypot(dx, dz));
    }
    this._subjectSpread = spread;
    return target;
  }

  start() {
    const loop = (now) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this._t += dt;
      for (const cb of this.tickCallbacks) cb(dt);

      // Camera tracking — extremely subtle. The look-at is *scaled down* from the
      // subject so even an extreme dice position only tilts the camera ≤ ~2°.
      this._computeSubject(this._camLookTarget);
      this._camLook.lerp(this._camLookTarget, 0.04);

      // Smoothed mouse position
      this._mouseX += (this._mouseNX - this._mouseX) * 0.04;
      this._mouseY += (this._mouseNY - this._mouseY) * 0.04;

      // Tiny idle bob — barely perceptible drift
      const bobX = Math.sin(this._t * 0.35) * 0.02;
      const bobY = Math.sin(this._t * 0.25 + 1.7) * 0.012;
      const bobZ = Math.cos(this._t * 0.22 + 0.9) * 0.02;

      // Position dolly — very minor bias toward subject + cursor.
      const subjX = this._camLook.x * 0.008;
      const subjY = Math.max(0, this._camLook.y) * 0.012;
      const subjZ = this._camLook.z * 0.006;
      const mouseShiftX = this._mouseX * 0.12;
      const mouseShiftY = -this._mouseY * 0.06;

      this.camera.position.set(
        this._camBase.x + bobX + subjX + mouseShiftX,
        this._camBase.y + bobY + subjY + mouseShiftY,
        this._camBase.z + bobZ + subjZ,
      );

      // Look-at: scale subject + mouse offsets way down so the camera tilts only
      // a couple degrees even when dice are far across the table or the cursor
      // is at a screen edge. (Camera is ~19u from origin; ≤0.6 units of offset
      // works out to ≤2° angular change.)
      const lookX = this._camLook.x * 0.05 + this._mouseX * 0.18;
      const lookY = this._camLook.y * 0.04;
      const lookZ = this._camLook.z * 0.05 + this._mouseY * 0.10;
      this.camera.lookAt(lookX, lookY, lookZ);

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
