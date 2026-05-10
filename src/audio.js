// Web Audio synthesized SFX — no asset files needed.
// All sounds are generated on the fly with oscillators + filtered noise.
// Audio context is lazy-initialized on first user gesture (browser autoplay rule).

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._lastCollide = 0;
    this._collideCount = 0;
  }

  ensure() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  _now() { return this.ctx.currentTime; }

  _env(gain, attack, hold, release, level) {
    const t = this._now();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.setValueAtTime(level, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  tone(freq, dur, type = 'sine', vol = 0.25, attack = 0.005) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g); g.connect(this.master);
    this._env(g, attack, 0.02, dur, vol);
    osc.start();
    osc.stop(this._now() + attack + 0.02 + dur + 0.05);
  }

  glide(fStart, fEnd, dur, type = 'sine', vol = 0.25) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.connect(g); g.connect(this.master);
    const t = this._now();
    osc.frequency.setValueAtTime(fStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
    this._env(g, 0.005, 0.01, dur, vol);
    osc.start();
    osc.stop(t + dur + 0.1);
  }

  noiseBurst(dur, freq, q, vol = 0.2) {
    if (!this.ctx || this.muted) return;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(dur * sr));
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.002, 0.01, dur, vol);
    src.start();
    src.stop(this._now() + dur + 0.1);
  }

  // ---- Game sounds ----

  click() { this.tone(1100, 0.04, 'square', 0.08); }
  pluck() { this.tone(880, 0.08, 'triangle', 0.18); }

  diceShake() {
    // Cup-shake: rapid filtered noise pulses with rising tone
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.noiseBurst(0.06, 1200 + Math.random() * 1500, 4, 0.13), i * 55);
    }
  }

  diceHitMat(intensity = 1) {
    const v = Math.max(0.05, Math.min(1, intensity));
    this.noiseBurst(0.08, 140, 2.5, 0.22 * v);
    this.tone(80 + Math.random() * 30, 0.04, 'sine', 0.18 * v);
  }

  diceHitDice(intensity = 1) {
    const v = Math.max(0.05, Math.min(1, intensity));
    // Sharp click — high band noise + tonal "tick"
    this.noiseBurst(0.04, 2200 + Math.random() * 1500, 6, 0.16 * v);
    this.tone(1500 + Math.random() * 500, 0.02, 'square', 0.06 * v);
  }

  // Throttled collision dispatcher — prevents audio overload
  collide(kind, intensity) {
    const now = performance.now();
    if (now - this._lastCollide < 18) return;
    this._lastCollide = now;
    if (kind === 'dice') this.diceHitDice(intensity);
    else this.diceHitMat(intensity);
  }

  selectDie() {
    this.tone(660, 0.06, 'triangle', 0.18);
    this.tone(990, 0.04, 'triangle', 0.12);
  }

  deselectDie() {
    this.tone(440, 0.05, 'triangle', 0.12);
  }

  scoreSmall(score) {
    // Ascending bell arpeggio scaled to score size
    const root = 523; // C5
    const ratios = [1, 1.25, 1.5, 1.875, 2.5]; // major-pentatonic-ish
    const count = Math.min(ratios.length, 1 + Math.floor(Math.log10(Math.max(50, score)) - 1));
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this.tone(root * ratios[i], 0.32, 'triangle', 0.28);
        this.tone(root * ratios[i] * 2, 0.32, 'sine', 0.12);
      }, i * 75);
    }
  }

  scoreBig() {
    // Triumphant chord stack with sparkles
    const root = 523;
    const chord = [0, 4, 7, 12, 16, 19, 24];
    chord.forEach((semi, i) => {
      setTimeout(() => {
        const f = root * Math.pow(2, semi / 12);
        this.tone(f, 0.55, 'triangle', 0.25);
        this.tone(f * 0.5, 0.55, 'sine', 0.12);
      }, i * 55);
    });
    for (let i = 0; i < 12; i++) {
      setTimeout(() => this.tone(2000 + Math.random() * 2500, 0.08, 'sine', 0.12), 400 + i * 60);
    }
  }

  bust() {
    // Sad descending wah
    this.glide(440, 110, 0.9, 'sawtooth', 0.32);
    setTimeout(() => this.glide(330, 90, 0.6, 'square', 0.18), 200);
  }

  bank() {
    // Cha-ching — coin + ding + jingle
    this.tone(1600, 0.1, 'square', 0.18);
    setTimeout(() => {
      this.tone(2400, 0.5, 'sine', 0.28);
      this.tone(3200, 0.5, 'sine', 0.18);
    }, 70);
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.tone(2500 + Math.random() * 1500, 0.07, 'sine', 0.14), 200 + i * 45);
    }
  }

  hotDice() {
    // Wild sweep + crowd-cheer-ish noise
    this.glide(220, 1760, 0.5, 'sawtooth', 0.18);
    setTimeout(() => this.scoreBig(), 200);
  }

  win() {
    // Fanfare: triadic ascending then sustained super-major chord
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.32), i * 130));
    setTimeout(() => {
      [1047, 1319, 1568, 2093].forEach((f, i) => {
        this.tone(f, 1.4, 'triangle', 0.3 - i * 0.05);
      });
      // Sparkle shower
      for (let i = 0; i < 30; i++) {
        setTimeout(() => this.tone(2500 + Math.random() * 3000, 0.09, 'sine', 0.12), i * 50);
      }
    }, 700);
  }

  turnStart() {
    this.tone(660, 0.08, 'triangle', 0.14);
    setTimeout(() => this.tone(880, 0.12, 'triangle', 0.18), 70);
  }
}
