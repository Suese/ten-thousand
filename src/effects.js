// Casino-style particle effects: confetti, coin shower, score popups.
// All DOM-based — no canvas needed, easy to layer over the three.js scene.

const COLORS = ['#ffe07a', '#ffb347', '#ff7c8a', '#7cf3a0', '#5a9bff', '#d96cff', '#ffd400', '#ff5cf2'];

function pickColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function spawn(el, vx, vy, gravity, life, rot) {
  document.body.appendChild(el);
  const start = performance.now();
  const animate = (now) => {
    const t = (now - start) / 1000;
    if (t > life) { el.remove(); return; }
    const px = vx * t;
    const py = vy * t + 0.5 * gravity * t * t;
    el.style.transform = `translate3d(${px}px, ${py}px, 0) rotate(${rot * t}deg)`;
    el.style.opacity = String(Math.max(0, 1 - Math.pow(t / life, 2)));
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

export function confettiBurst(x, y, count = 40) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.background = pickColor();
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = (5 + Math.random() * 6) + 'px';
    el.style.height = (8 + Math.random() * 10) + 'px';
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 320 + Math.random() * 380;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const rot = (Math.random() - 0.5) * 1080;
    spawn(el, vx, vy, 1300, 1.6 + Math.random() * 0.5, rot);
  }
}

// `count` is how many coins to launch; `durationMs` is the spawn window —
// bigger banks both spawn more coins and stretch the spawn window so the
// celebration visibly lasts longer.
export function coinShower(x, y, count = 30, durationMs = null) {
  const window = durationMs ?? Math.max(600, count * 25);
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'coin';
      el.textContent = '$';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 380 + Math.random() * 360;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      spawn(el, vx, vy, 1500, 1.8, (Math.random() - 0.5) * 720);
    }, (i / count) * window);
  }
}

export function scorePopup(text, x, y, opts = {}) {
  const el = document.createElement('div');
  el.className = 'score-popup';
  if (opts.big) el.classList.add('big');
  if (opts.bust) el.classList.add('bust');
  if (opts.bank) el.classList.add('bank');
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

export function flashScreen(color = '#ffe07a', alpha = 0.35) {
  const el = document.createElement('div');
  el.className = 'screen-flash';
  el.style.background = color;
  el.style.opacity = String(alpha);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

export function shake(targetEl, intensity = 6, duration = 350) {
  if (!targetEl) return;
  const start = performance.now();
  const animate = (now) => {
    const t = (now - start) / duration;
    if (t >= 1) { targetEl.style.transform = ''; return; }
    const k = (1 - t) * intensity;
    const x = (Math.random() - 0.5) * 2 * k;
    const y = (Math.random() - 0.5) * 2 * k;
    targetEl.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

// Center coordinates of an element for spawning effects from it
export function centerOf(el) {
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Cartoony comic-book burst — colorful jagged starburst with bold outlined text.
// Used for flicks ("POW!") and tornado hits ("KABLAM!").
const COMIC_PALETTES = [
  { bg: '#ff4757', fg: '#fff7c2' },
  { bg: '#ffd400', fg: '#a30010' },
  { bg: '#5a9bff', fg: '#ffffff' },
  { bg: '#7cf3a0', fg: '#062a13' },
  { bg: '#ff5cd6', fg: '#fff7c2' },
  { bg: '#ff8c2b', fg: '#1a0a00' },
];
const FLICK_WORDS = ['SLAP!', 'POW!', 'BIFF!', 'ZAP!', 'BAM!', 'THWAP!'];
const HIT_WORDS = ['KABLAM!', 'WHAM!', 'BOOM!', 'SOCK!', 'KAPOW!', 'WHACK!', 'CRASH!'];

export function comicBurst(x, y, text = 'POW!') {
  const palette = COMIC_PALETTES[(Math.random() * COMIC_PALETTES.length) | 0];
  const rot = (Math.random() - 0.5) * 30;
  const el = document.createElement('div');
  el.className = 'comic-burst';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--burst-bg', palette.bg);
  el.style.setProperty('--burst-fg', palette.fg);
  el.style.setProperty('--burst-rot', rot + 'deg');
  el.innerHTML = `<span>${text}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
export function comicBurstFlick(x, y) {
  comicBurst(x, y, FLICK_WORDS[(Math.random() * FLICK_WORDS.length) | 0]);
}
export function comicBurstHit(x, y) {
  comicBurst(x, y, HIT_WORDS[(Math.random() * HIT_WORDS.length) | 0]);
}

// Blood-splat burst — red/dark-red particles spraying outward from a point.
export function bloodSplat(x, y, count = 28) {
  const colors = ['#a30000', '#d80020', '#7a0010', '#ff3050', '#5a000a'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'blood-spot';
    el.style.background = colors[(Math.random() * colors.length) | 0];
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const sz = 4 + Math.random() * 9;
    el.style.width = sz + 'px';
    el.style.height = sz + 'px';
    const angle = Math.random() * Math.PI * 2;
    const speed = 180 + Math.random() * 320;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    document.body.appendChild(el);
    const start = performance.now();
    const life = 0.9 + Math.random() * 0.4;
    const animate = (now) => {
      const t = (now - start) / 1000;
      if (t > life) { el.remove(); return; }
      const px = vx * t;
      const py = vy * t + 0.5 * 700 * t * t;
      el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      el.style.opacity = String(Math.max(0, 1 - Math.pow(t / life, 1.5)));
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
}
