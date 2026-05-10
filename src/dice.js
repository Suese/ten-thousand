import * as THREE from 'three';

const FACE_VALUES = [1, 6, 2, 5, 3, 4];
const FACE_AXES = [
  new THREE.Vector3( 1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3( 0, 1, 0),
  new THREE.Vector3( 0,-1, 0),
  new THREE.Vector3( 0, 0, 1),
  new THREE.Vector3( 0, 0,-1),
];

const SCHEMES = {
  red: {
    bgInner: '#d8243f', bgOuter: '#c8102e',
    pipInner: '#ffffff', pipMid: '#fafafa', pipOuter: '#cfcfcf',
    pipHighlight: 'rgba(255,255,255,0.6)',
    pipShadow: 'rgba(0,0,0,0.3)',
    grain: 'rgba(255,255,255,0.04)',
  },
  gold: {
    bgInner: '#ffe88a', bgOuter: '#c89a1c',
    pipInner: '#2a1700', pipMid: '#1a0e00', pipOuter: '#0f0800',
    pipHighlight: 'rgba(255,224,128,0.45)',
    pipShadow: 'rgba(0,0,0,0.55)',
    grain: 'rgba(255,255,255,0.05)',
  },
};

function pipTexture(value, schemeName = 'red') {
  const scheme = SCHEMES[schemeName] || SCHEMES.red;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Background
  const grad = ctx.createRadialGradient(size/2, size/2, 20, size/2, size/2, size*0.85);
  grad.addColorStop(0, scheme.bgInner);
  grad.addColorStop(1, scheme.bgOuter);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const vign = ctx.createRadialGradient(size/2, size/2, size*0.3, size/2, size/2, size*0.75);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = scheme.grain.replace(/[\d.]+\)/, m => (Math.random() * parseFloat(m)).toFixed(3) + ')');
    ctx.fillRect(Math.random()*size, Math.random()*size, 1, 1);
  }

  const positions = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.5], [0.73, 0.5], [0.27, 0.73], [0.73, 0.73]],
  };

  const drawPip = (cx, cy, r) => {
    ctx.fillStyle = scheme.pipShadow;
    ctx.beginPath();
    ctx.arc(cx + 1, cy + 2, r, 0, Math.PI * 2);
    ctx.fill();
    const pg = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, 1, cx, cy, r);
    pg.addColorStop(0, scheme.pipInner);
    pg.addColorStop(0.7, scheme.pipMid);
    pg.addColorStop(1, scheme.pipOuter);
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = scheme.pipHighlight;
    ctx.beginPath();
    ctx.arc(cx - r*0.35, cy - r*0.35, r*0.3, 0, Math.PI * 2);
    ctx.fill();
  };

  const baseR = value === 1 ? 32 : 22;
  for (const [px, py] of positions[value]) {
    drawPip(px * size, py * size, baseR);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Build a chamfered (truncated) cube geometry — full unit cube outline with
// beveled edges and corners. Six face groups (materialIndex 0..5) carry pip
// textures; group 6 covers all chamfer faces (red body color).
function createChamferedDieGeometry(size = 1, chamfer = 0.08) {
  const s = size / 2;
  const e = s - chamfer;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const groups = []; // {start, count, materialIndex}

  let nextVert = 0;

  function pushQuad(verts, normal, uvCoords, materialIndex) {
    const start = indices.length;
    const base = nextVert;
    for (let i = 0; i < 4; i++) {
      positions.push(verts[i][0], verts[i][1], verts[i][2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(uvCoords[i][0], uvCoords[i][1]);
      nextVert++;
    }
    indices.push(base, base + 1, base + 2);
    indices.push(base, base + 2, base + 3);
    groups.push({ start, count: 6, materialIndex });
  }

  function pushTri(verts, normal, materialIndex) {
    const start = indices.length;
    const base = nextVert;
    for (let i = 0; i < 3; i++) {
      positions.push(verts[i][0], verts[i][1], verts[i][2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(0.5, 0.5);
      nextVert++;
    }
    indices.push(base, base + 1, base + 2);
    groups.push({ start, count: 3, materialIndex });
  }

  // Six main faces
  pushQuad(
    [[ s, -e, -e], [ s,  e, -e], [ s,  e,  e], [ s, -e,  e]],
    [1, 0, 0],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    0,
  );
  pushQuad(
    [[-s, -e,  e], [-s,  e,  e], [-s,  e, -e], [-s, -e, -e]],
    [-1, 0, 0],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    1,
  );
  pushQuad(
    [[-e,  s,  e], [ e,  s,  e], [ e,  s, -e], [-e,  s, -e]],
    [0, 1, 0],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    2,
  );
  pushQuad(
    [[-e, -s, -e], [ e, -s, -e], [ e, -s,  e], [-e, -s,  e]],
    [0, -1, 0],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    3,
  );
  pushQuad(
    [[-e, -e,  s], [ e, -e,  s], [ e,  e,  s], [-e,  e,  s]],
    [0, 0, 1],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    4,
  );
  pushQuad(
    [[ e, -e, -s], [-e, -e, -s], [-e,  e, -s], [ e,  e, -s]],
    [0, 0, -1],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    5,
  );

  const norm2 = (a, b) => { const l = Math.hypot(a, b); return [a / l, b / l]; };
  const norm3 = (a, b, c) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; };

  // 12 edge chamfer rectangles. Order vertices CCW when viewed from outside.
  const edges = [
    // Edges parallel to Z axis (4)
    { q: [[ s,  e, -e], [ e,  s, -e], [ e,  s,  e], [ s,  e,  e]], n: [...norm2( 1,  1), 0] },
    { q: [[ e, -s, -e], [ s, -e, -e], [ s, -e,  e], [ e, -s,  e]], n: [...norm2( 1, -1), 0] },
    { q: [[-e,  s, -e], [-s,  e, -e], [-s,  e,  e], [-e,  s,  e]], n: [...norm2(-1,  1), 0] },
    { q: [[-s, -e, -e], [-e, -s, -e], [-e, -s,  e], [-s, -e,  e]], n: [...norm2(-1, -1), 0] },
    // Edges parallel to X axis (4)
    { q: [[-e,  s,  e], [-e,  e,  s], [ e,  e,  s], [ e,  s,  e]], n: [0, ...norm2(1, 1)] },
    { q: [[ e,  s, -e], [ e,  e, -s], [-e,  e, -s], [-e,  s, -e]], n: [0, ...norm2(1, -1)] },
    { q: [[ e, -s,  e], [ e, -e,  s], [-e, -e,  s], [-e, -s,  e]], n: [0, ...norm2(-1, 1)] },
    { q: [[-e, -s, -e], [-e, -e, -s], [ e, -e, -s], [ e, -s, -e]], n: [0, ...norm2(-1, -1)] },
    // Edges parallel to Y axis (4) — winding reversed from the X/Z patterns
    // because rotating +X→+Z (around +Y) goes the opposite direction.
    { q: [[ s, -e,  e], [ s,  e,  e], [ e,  e,  s], [ e, -e,  s]], n: [norm2( 1,  1)[0], 0, norm2( 1,  1)[1]] },
    { q: [[ s,  e, -e], [ s, -e, -e], [ e, -e, -s], [ e,  e, -s]], n: [norm2( 1, -1)[0], 0, norm2( 1, -1)[1]] },
    { q: [[-e,  e,  s], [-s,  e,  e], [-s, -e,  e], [-e, -e,  s]], n: [norm2(-1,  1)[0], 0, norm2(-1,  1)[1]] },
    { q: [[-e, -e, -s], [-s, -e, -e], [-s,  e, -e], [-e,  e, -s]], n: [norm2(-1, -1)[0], 0, norm2(-1, -1)[1]] },
  ];

  for (const ed of edges) {
    pushQuad(ed.q, ed.n, [[0, 0], [1, 0], [1, 1], [0, 1]], 6);
  }

  // 8 corner triangles
  const cornerSigns = [
    [ 1,  1,  1], [ 1,  1, -1], [ 1, -1,  1], [ 1, -1, -1],
    [-1,  1,  1], [-1,  1, -1], [-1, -1,  1], [-1, -1, -1],
  ];

  for (const [sx, sy, sz] of cornerSigns) {
    const v0 = [sx * s, sy * e, sz * e];
    const v1 = [sx * e, sy * s, sz * e];
    const v2 = [sx * e, sy * e, sz * s];
    const n = norm3(sx, sy, sz);
    // Winding: check sign of (sx*sy*sz)
    const order = (sx * sy * sz > 0) ? [v0, v1, v2] : [v0, v2, v1];
    pushTri(order, n, 6);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  for (const grp of groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  return g;
}

function makeDieMaterials(scheme) {
  const isGold = scheme === 'gold';

  const faceMats = FACE_VALUES.map(v => {
    if (isGold) {
      return new THREE.MeshPhysicalMaterial({
        map: pipTexture(v, scheme),
        roughness: 0.22, metalness: 0.85,
        clearcoat: 0.5, clearcoatRoughness: 0.12,
        sheen: 0.1, sheenColor: new THREE.Color(0xffffff),
      });
    }
    // "Glassy" red — no transmission (huge perf cost). Faked via deep clearcoat,
    // very low roughness, and strong env-map reflections from the casino IBL.
    return new THREE.MeshPhysicalMaterial({
      map: pipTexture(v, scheme),
      color: new THREE.Color('#ffffff'),     // let the texture supply color
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      reflectivity: 0.6,
      sheen: 0.15,
      sheenColor: new THREE.Color(0xffffff),
    });
  });

  const bodyMat = isGold
    ? new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#d4a017'),
        roughness: 0.22, metalness: 0.85,
        clearcoat: 0.55, clearcoatRoughness: 0.12,
        emissive: new THREE.Color('#3a2400'),
        emissiveIntensity: 0.35,
      })
    : new THREE.MeshPhysicalMaterial({
        // Cherry-red polished plastic for the chamfered edges. Solid (no
        // transmission) but reads as glassy because of the deep clearcoat
        // and IBL reflections off the env map.
        color: new THREE.Color('#d8243f'),
        roughness: 0.06,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        reflectivity: 0.7,
      });

  return [...faceMats, bodyMat];
}

export function createDieMesh() {
  const geom = createChamferedDieGeometry(1, 0.09);
  const redMats = makeDieMaterials('red');
  const goldMats = makeDieMaterials('gold');
  const mesh = new THREE.Mesh(geom, redMats);
  mesh.userData.materialsRed = redMats;
  mesh.userData.materialsGold = goldMats;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Returns the face value of whichever face is currently most-aligned with world up,
// regardless of how tilted the die is.
export function readDieValue(quat) {
  return readDieFaceAndAlignment(quat).value;
}

// Returns { value, alignment } — alignment is dot(face_normal, world_up) in [-1, 1].
// alignment ≥ 0.85 means the face is roughly flat / pointing upward (within ~32°).
export function readDieFaceAndAlignment(quat) {
  const q = (quat instanceof THREE.Quaternion)
    ? quat
    : new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w);
  let bestDot = -Infinity;
  let bestValue = 1;
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < FACE_AXES.length; i++) {
    tmp.copy(FACE_AXES[i]).applyQuaternion(q);
    const dot = tmp.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = FACE_VALUES[i];
    }
  }
  return { value: bestValue, alignment: bestDot };
}
