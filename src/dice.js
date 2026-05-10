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

function pipTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#cdbfa3';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const r = 22;
  const positions = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.5], [0.73, 0.5], [0.27, 0.73], [0.73, 0.73]],
  };

  if (value === 1) {
    ctx.fillStyle = '#c83b30';
    ctx.beginPath();
    ctx.arc(size/2, size/2, r * 1.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1a1a1a';
    for (const [px, py] of positions[value]) {
      ctx.beginPath();
      ctx.arc(px * size, py * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export function createDieMesh() {
  const size = 1;
  const geom = new THREE.BoxGeometry(size, size, size, 1, 1, 1);
  const materials = FACE_VALUES.map(v => new THREE.MeshStandardMaterial({
    map: pipTexture(v),
    roughness: 0.45,
    metalness: 0.05,
  }));
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
