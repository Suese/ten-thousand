import * as THREE from 'three';

// Procedural wood texture for the table rim. Vertical grain with knots.
export function woodTexture(opts = {}) {
  const w = opts.width ?? 512;
  const h = opts.height ?? 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Base warm brown gradient
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#5a2f15');
  base.addColorStop(0.5, '#763a18');
  base.addColorStop(1, '#4a2511');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Long horizontal grain lines (rim runs along the long axis)
  for (let i = 0; i < 220; i++) {
    const y = Math.random() * h;
    const opacity = 0.06 + Math.random() * 0.16;
    const dark = Math.random() < 0.4;
    ctx.strokeStyle = dark
      ? `rgba(30, 14, 6, ${opacity})`
      : `rgba(170, 110, 60, ${opacity})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    let x = 0;
    while (x < w) {
      const dx = 8 + Math.random() * 30;
      const dy = (Math.random() - 0.5) * 1.4;
      x += dx;
      ctx.lineTo(x, y + dy);
    }
    ctx.stroke();
  }

  // Sparse knots
  for (let i = 0; i < 4; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 6 + Math.random() * 10;
    const k = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    k.addColorStop(0, 'rgba(20, 8, 4, 0.85)');
    k.addColorStop(1, 'rgba(20, 8, 4, 0)');
    ctx.fillStyle = k;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tiny grain speckle
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Procedural felt texture for the table surface — fine fiber speckle.
export function feltTexture(opts = {}) {
  const w = opts.width ?? 1024;
  const h = opts.height ?? 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Deep felt green with subtle radial vignette
  ctx.fillStyle = '#0e3a23';
  ctx.fillRect(0, 0, w, h);
  const vign = ctx.createRadialGradient(w/2, h/2, w*0.2, w/2, h/2, w*0.7);
  vign.addColorStop(0, 'rgba(40, 110, 70, 0.18)');
  vign.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w, h);

  // Random short fiber strokes (the "felt fluff")
  const palette = ['#0a2e1a', '#103a22', '#1a5535', '#0f4426', '#072216'];
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 1 + Math.random() * 3;
    const ang = Math.random() * Math.PI * 2;
    ctx.strokeStyle = palette[(Math.random() * palette.length) | 0] + 'cc';
    ctx.lineWidth = 0.6 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // Faint scratchy dust
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Simple bump texture from any canvas-derived texture
export function bumpFrom(tex) {
  const t = tex.clone();
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
