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

// Canvas-drawn stink-line texture used as a billboard sprite above each dookie.
function makeStinkTexture() {
  const W = 64, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#6dc44d';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  // Three vertical wavy lines, each slightly offset
  for (let i = 0; i < 3; i++) {
    const x0 = 14 + i * 18;
    ctx.beginPath();
    let y = H - 8;
    let drew = false;
    while (y > 6) {
      const wave = Math.sin((H - y) * 0.35 + i * 1.4) * 6;
      const px = x0 + wave;
      if (!drew) { ctx.moveTo(px, y); drew = true; }
      else ctx.lineTo(px, y);
      y -= 3.5;
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
    // Stencil mask: where a portable-hole disc has stamped a 1, discard this
    // material's fragments so the felt physically "has a hole" instead of a
    // circle drawn on top of it.
    tableMat.stencilWrite = true;
    tableMat.stencilFunc = THREE.NotEqualStencilFunc;
    tableMat.stencilRef = 1;
    tableMat.stencilFail = THREE.KeepStencilOp;
    tableMat.stencilZFail = THREE.KeepStencilOp;
    tableMat.stencilZPass = THREE.KeepStencilOp;
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
    // Ice material — two-layer model. Base layer: ice.png from the project root
    // (the under layer). On top: clearcoat = the slightly reflective sheen layer.
    // Falls back to the procedural iceTexture if ice.png is missing.
    const proceduralIce = iceTexture();
    this._iceMat = new THREE.MeshPhysicalMaterial({
      map: proceduralIce,
      bumpMap: bumpFrom(proceduralIce),
      bumpScale: 0.05,
      roughness: 0.55,        // base layer — matte-ish ice
      metalness: 0,
      clearcoat: 1.0,         // over-top reflective sheen
      clearcoatRoughness: 0.05,
      emissive: 0x1a3a55,
      emissiveIntensity: 0.10,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this._iceMat.stencilWrite = true;
    this._iceMat.stencilFunc = THREE.NotEqualStencilFunc;
    this._iceMat.stencilRef = 1;
    this._iceMat.stencilFail = THREE.KeepStencilOp;
    this._iceMat.stencilZFail = THREE.KeepStencilOp;
    this._iceMat.stencilZPass = THREE.KeepStencilOp;

    // Try to load ice.png as a raw Image (so we can composite a logo onto it).
    {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this._iceImage = img;
        this._rebakeIce();
      };
      img.onerror = () => {/* keep procedural */};
      img.src = './ice.png';
    }
    this._logoImage = null;
    this._iceImage = null;

    // Container for dookie blob meshes
    this._dookieMeshes = new Map(); // key -> mesh
    this._stinkTexture = makeStinkTexture();

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
    const m = this.dieMeshes[i];
    const offstage = pos[1] < -5;
    const inHand = this._inHandSet && this._inHandSet.has(i);
    m.visible = visible && !offstage && !inHand;
    m.position.set(pos[0], pos[1], pos[2]);
    m.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    const sel = this.selectionRings[i];
    sel.position.x = pos[0];
    sel.position.z = pos[2];
    if (offstage || inHand) sel.visible = false;
    const lock = m.userData.lockRing;
    lock.position.x = pos[0];
    lock.position.z = pos[2];
    if (offstage || inHand) lock.visible = false;
  }

  setInHand(indices) {
    this._inHandSet = new Set(indices || []);
    // Apply visibility immediately to currently-visible dice
    for (let i = 0; i < this.dieMeshes.length; i++) {
      if (this._inHandSet.has(i)) {
        this.dieMeshes[i].visible = false;
        this.selectionRings[i].visible = false;
        this.dieMeshes[i].userData.lockRing.visible = false;
      }
    }
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

  // Portable Hole — spawns a black disc on the table at `worldPos`. The disc
  // writes a stencil ref of 1; the felt/ice materials are configured to
  // discard fragments where stencil == 1, so the table genuinely has a hole.
  // The disc itself is opaque black with depth-write enabled, so the die — now
  // physically falling through the felt via cannon ghosting — is occluded as
  // it descends below table level, creating the "fell through" effect.
  playPortableHoleAnimation(dieIndex, worldPos) {
    const sel = this.selectionRings[dieIndex];
    const lock = this.dieMeshes[dieIndex].userData.lockRing;
    sel.visible = false;
    lock.visible = false;

    const discGeom = new THREE.CircleGeometry(0.95, 36);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilRef: 1,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const disc = new THREE.Mesh(discGeom, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(worldPos[0], 0.004, worldPos[2]);
    disc.scale.setScalar(0.05);
    // Render before the felt so its stencil write is in place when the felt
    // tests against it.
    disc.renderOrder = -1;
    this.scene.add(disc);

    const start = performance.now();
    const duration = 1100;
    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // Disc grows quickly, holds, then shrinks at the end.
      let scale;
      if (t < 0.18) scale = t / 0.18;
      else if (t > 0.85) scale = (1 - t) / 0.15;
      else scale = 1;
      disc.scale.setScalar(0.1 + 0.95 * Math.max(0, Math.min(1, scale)));

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(disc);
        discGeom.dispose();
        discMat.dispose();
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

  // Bake a logo image (HTMLImageElement) into both surface textures. Felt is
  // procedural so it's regenerated with the logo via feltTexture(). Ice may be
  // either ice.png + logo (canvas composite) or procedural + logo, depending on
  // whether ice.png has loaded yet.
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

    this._rebakeIce();
  }

  // Composes the current state of (ice image / procedural ice) with (logo tinted
  // navy blue) into a single CanvasTexture and applies it to the ice material.
  _rebakeIce() {
    const NAVY = '#0b1f4a';
    const W = 1408, H = 1024;

    let tex;
    if (this._iceImage) {
      // Build a canvas: ice.png base + navy-tinted logo silhouette overlay.
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      // Draw ice.png stretched to the canvas (cover the table area).
      ctx.drawImage(this._iceImage, 0, 0, W, H);

      if (this._logoImage) {
        const fraction = 0.55;
        const opacity = 0.62;
        const targetSize = Math.min(W, H) * fraction;
        const aspect = this._logoImage.width / this._logoImage.height;
        let lw, lh;
        if (aspect >= 1) { lw = targetSize; lh = targetSize / aspect; }
        else             { lh = targetSize; lw = targetSize * aspect; }
        const x = (W - lw) / 2;
        const y = (H - lh) / 2;

        // Tint the logo to navy: draw into a temp canvas, then source-in fill
        // replaces every non-transparent pixel with navy.
        const tmp = document.createElement('canvas');
        tmp.width = lw; tmp.height = lh;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(this._logoImage, 0, 0, lw, lh);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = NAVY;
        tctx.fillRect(0, 0, lw, lh);

        // Layer it onto the ice. multiply darkens the ice where the logo is, so
        // it reads as "frozen into the surface" rather than painted on top.
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(tmp, x, y);
        ctx.restore();
        // Tiny extra darken so the logo reads even in bright areas.
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(tmp, x, y);
        ctx.restore();
      }

      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      // ice.png hasn't loaded — fall back to the procedural ice with logo baked in.
      tex = iceTexture({}, this._logoImage);
    }

    if (this._iceMat.map) this._iceMat.map.dispose();
    if (this._iceMat.bumpMap) this._iceMat.bumpMap.dispose();
    this._iceMat.map = tex;
    this._iceMat.bumpMap = bumpFrom(tex);
    this._iceMat.needsUpdate = true;
  }

  syncDookieZones(zones) {
    const want = new Set(zones.map(z => `${z.x.toFixed(2)}:${z.z.toFixed(2)}`));
    // Remove gone
    for (const [key, mesh] of [...this._dookieMeshes.entries()]) {
      if (!want.has(key)) {
        if (mesh.userData.stinkInterval) clearInterval(mesh.userData.stinkInterval);
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

      // Stink lines — small wavy-green billboards that rise from the blob, fade out,
      // and respawn periodically while the dookie still exists.
      const spawnStink = () => {
        if (!this._dookieMeshes.has(key)) return;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._stinkTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0.85,
        }));
        const sx = z.x + (Math.random() - 0.5) * z.r * 0.7;
        const sz = z.z + (Math.random() - 0.5) * z.r * 0.7;
        sprite.position.set(sx, 0.3, sz);
        sprite.scale.set(0.6, 1.1, 1);
        this.scene.add(sprite);
        const start = performance.now();
        const life = 1500 + Math.random() * 500;
        const animate = (now) => {
          const t = (now - start) / life;
          if (t >= 1) {
            this.scene.remove(sprite);
            sprite.material.dispose();
            return;
          }
          sprite.position.y = 0.3 + t * 2.2;
          sprite.material.opacity = 0.85 * (1 - t * t);
          sprite.scale.set(0.6 - t * 0.15, 1.1 - t * 0.2, 1);
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      };
      // Initial stink + ongoing periodic emission (rate halved).
      setTimeout(spawnStink, 0);
      m.userData.stinkInterval = setInterval(spawnStink, 1100 + Math.random() * 700);
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

      // Position dolly — very minor bias toward subject, mouse parallax doubled.
      const subjX = this._camLook.x * 0.008;
      const subjY = Math.max(0, this._camLook.y) * 0.012;
      const subjZ = this._camLook.z * 0.006;
      const mouseShiftX = this._mouseX * 0.24;
      const mouseShiftY = -this._mouseY * 0.12;

      const baseX = this._camBase.x + bobX + subjX + mouseShiftX;
      const baseY = this._camBase.y + bobY + subjY + mouseShiftY;
      const baseZ = this._camBase.z + bobZ + subjZ;

      // Look-at — mouse parallax doubled.
      const lookX = this._camLook.x * 0.05 + this._mouseX * 0.36;
      const lookY = this._camLook.y * 0.04;
      const lookZ = this._camLook.z * 0.05 + this._mouseY * 0.20;
      const lookAt = new THREE.Vector3(lookX, lookY, lookZ);

      // Place the camera at the base position and aim it.
      this.camera.position.set(baseX, baseY, baseZ);
      this.camera.lookAt(lookAt);
      this.camera.updateMatrixWorld(true);

      // Frame guard: project every visible die to NDC and find the worst-offending
      // |x| / |y|. If any die is outside the safe-zone, push the camera back along
      // the (basePosition → lookAt) axis so it fits. Smoothly relaxes back to 1.0
      // when dice return to the middle of the frame.
      const SAFE_ZONE = 0.85;
      const tmpProj = new THREE.Vector3();
      let maxAbs = 0;
      for (const m of this.dieMeshes) {
        if (!m.visible) continue;
        if (m.position.y < -1) continue; // parked offstage
        tmpProj.copy(m.position).project(this.camera);
        if (Math.abs(tmpProj.x) > maxAbs) maxAbs = Math.abs(tmpProj.x);
        if (Math.abs(tmpProj.y) > maxAbs) maxAbs = Math.abs(tmpProj.y);
      }
      const targetZoom = Math.max(1.0, maxAbs / SAFE_ZONE);
      this._zoomMult = (this._zoomMult ?? 1.0) + (targetZoom - (this._zoomMult ?? 1.0)) * 0.1;
      if (Math.abs(this._zoomMult - 1.0) > 0.003) {
        const basePos = new THREE.Vector3(baseX, baseY, baseZ);
        const offset = basePos.sub(lookAt).multiplyScalar(this._zoomMult);
        this.camera.position.copy(lookAt).add(offset);
        this.camera.lookAt(lookAt);
      }

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
