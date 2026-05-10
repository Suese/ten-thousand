import * as THREE from 'three';

// Draw an image centered on a 2D canvas, scaled to fit a target box and preserving aspect.
// Returns the rect it occupied for callers that want to layer effects over it.
function drawLogoCentered(ctx, image, canvasW, canvasH, opts = {}) {
  if (!image || !image.width) return null;
  const fraction = opts.fraction ?? 0.55;
  const opacity = opts.opacity ?? 0.55;
  const composite = opts.composite ?? 'source-over';
  const tint = opts.tint;

  const targetSize = Math.min(canvasW, canvasH) * fraction;
  const aspect = image.width / image.height;
  let w, h;
  if (aspect >= 1) { w = targetSize; h = targetSize / aspect; }
  else             { h = targetSize; w = targetSize * aspect; }
  const x = (canvasW - w) / 2;
  const y = (canvasH - h) / 2;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = composite;
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();

  if (tint) {
    ctx.save();
    ctx.globalAlpha = opacity * 0.5;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  return { x, y, w, h };
}

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
// Pass `logoImage` (HTMLImageElement) to bake a logo into the felt itself.
// Fibers drawn AFTER the logo make it look woven into the felt fabric.
export function feltTexture(opts = {}, logoImage = null) {
  const w = opts.width ?? 1408;
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

  // First pass of fibers — denser background under any logo so it reads as part of the felt.
  const palette = ['#0a2e1a', '#103a22', '#1a5535', '#0f4426', '#072216'];
  const drawFibers = (count) => {
    for (let i = 0; i < count; i++) {
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
  };
  drawFibers(15000);

  // Logo bakes here — multiply-blend so it darkens the felt where it's drawn,
  // tinted toward the felt green so it doesn't fight the surface.
  if (logoImage) {
    drawLogoCentered(ctx, logoImage, w, h, {
      fraction: 0.55,
      opacity: 0.7,
      composite: 'multiply',
    });
    drawLogoCentered(ctx, logoImage, w, h, {
      fraction: 0.55,
      opacity: 0.18,
      composite: 'screen',
    });
  }

  // Second pass of fibers — drawn ON TOP of the logo so fibers cross through it,
  // selling the "embroidered into the felt" look.
  drawFibers(15000);

  // Faint scratchy dust
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Procedural scratched-ice texture. Pale blue base + curving skate scratches + cracks.
// Pass `logoImage` (HTMLImageElement) to bake a logo into the ice — scratches will
// cross over it for that "frozen embedded" look.
export function iceTexture(opts = {}, logoImage = null) {
  const w = opts.width ?? 1408;
  const h = opts.height ?? 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Base — pale icy gradient
  const grad = ctx.createRadialGradient(w/2, h/2, w*0.1, w/2, h/2, w*0.7);
  grad.addColorStop(0, '#dbecff');
  grad.addColorStop(0.5, '#bcdcfb');
  grad.addColorStop(1, '#92bbe8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Mottled tint — simulates uneven freeze
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 30 + Math.random() * 90;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.04 + Math.random() * 0.08})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bake the logo here — overlay-blend so it tints with the ice, then scratches cross it.
  if (logoImage) {
    drawLogoCentered(ctx, logoImage, w, h, {
      fraction: 0.55,
      opacity: 0.55,
      composite: 'overlay',
    });
    drawLogoCentered(ctx, logoImage, w, h, {
      fraction: 0.55,
      opacity: 0.25,
      composite: 'multiply',
    });
  }

  // Long curving skate scratches — chains of slightly drifting line segments
  const scratchCount = 120;
  for (let i = 0; i < scratchCount; i++) {
    const x0 = Math.random() * w;
    const y0 = Math.random() * h;
    const len = 30 + Math.random() * 280;
    let x = x0, y = y0;
    const baseAng = Math.random() * Math.PI * 2;
    let ang = baseAng;
    const opacity = 0.18 + Math.random() * 0.45;
    ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
    ctx.lineWidth = 0.4 + Math.random() * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    let traveled = 0;
    while (traveled < len) {
      const step = 6 + Math.random() * 12;
      ang += (Math.random() - 0.5) * 0.18;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      ctx.lineTo(x, y);
      traveled += step;
    }
    ctx.stroke();

    // A few have a fine darker shadow alongside (depth)
    if (Math.random() < 0.35) {
      ctx.strokeStyle = `rgba(40,80,120,${opacity * 0.4})`;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
  }

  // Hairline cracks — short jagged lines
  for (let i = 0; i < 60; i++) {
    let x = Math.random() * w;
    let y = Math.random() * h;
    const segs = 3 + Math.floor(Math.random() * 4);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.4})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < segs; s++) {
      x += (Math.random() - 0.5) * 30;
      y += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Speckle dust
  for (let i = 0; i < 4500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
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
