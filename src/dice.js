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

const RED = '#c8102e';      // cherry casino red
const RED_DARK = '#8b0a1f';
const WHITE = '#fafafa';

function pipTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Red gradient background for slight depth
  const grad = ctx.createRadialGradient(size/2, size/2, 20, size/2, size/2, size*0.85);
  grad.addColorStop(0, '#d8243f');
  grad.addColorStop(1, RED);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle inner shadow / vignette for depth
  const vign = ctx.createRadialGradient(size/2, size/2, size*0.3, size/2, size/2, size*0.75);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, size, size);

  // Tiny grain
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random()*0.04})`;
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

  // Pip with subtle highlight
  const drawPip = (cx, cy, r) => {
    // shadow ring
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(cx + 1, cy + 2, r, 0, Math.PI * 2);
    ctx.fill();
    // main white
    const pg = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, 1, cx, cy, r);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.7, WHITE);
    pg.addColorStop(1, '#cfcfcf');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // tiny shine
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
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
    { q: [[-e,  e,  s], [-e, -e,  s], [-s, -e,  e], [-s,  e,  e]], n: [norm2(-1,  1)[0], 0, norm2(-1,  1)[1]] },
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

export function createDieMesh() {
  const geom = createChamferedDieGeometry(1, 0.09);

  // 0..5: face textures, 6: chamfer body color
  const faceMats = FACE_VALUES.map(v => new THREE.MeshPhysicalMaterial({
    map: pipTexture(v),
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.18,
    sheen: 0.1,
    sheenColor: new THREE.Color(0xffffff),
  }));
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(RED),
    roughness: 0.35,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  });

  const materials = [...faceMats, bodyMat];
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function readDieValue(quat) {
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
  return bestValue;
}
