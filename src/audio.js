// Zvuky syntetizované přes WebAudio — žádné soubory ke stažení.
export class Sfx {
  constructor() { this.ctx = null; this.jet = null; }

  // prohlížeč povolí zvuk až po akci uživatele (klik / vstup do VR)
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // smyčka šumu pro jetpack
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    this.jet = this.ctx.createGain(); this.jet.gain.value = 0;
    src.connect(f).connect(this.jet).connect(this.master);
    src.start();
  }

  tone(freq, dur, type = 'square', vol = 0.2, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  noise(dur, vol = 0.3, freq = 1200) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }

  jetpack(level) {
    if (this.jet) this.jet.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.05);
  }

  play(ev) {
    switch (ev) {
      case 'shoot': this.tone(880, 0.09, 'square', 0.12, 0.4); break;
      case 'hit': this.noise(0.08, 0.25, 2500); break;
      case 'kill': this.noise(0.45, 0.45, 900); this.tone(180, 0.35, 'sawtooth', 0.2, 0.3); break;
      case 'spark': this.noise(0.04, 0.08, 3000); break;
      case 'enemyShot': this.tone(300, 0.25, 'triangle', 0.15, 1.8); break;
      case 'playerHit': this.tone(120, 0.5, 'sawtooth', 0.35, 0.5); break;
      case 'pickup': [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'square', 0.15), i * 70)); break;
      case 'doorOpen': this.tone(220, 0.8, 'triangle', 0.25, 4); break;
      case 'levelDone': [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.18), i * 110)); break;
      case 'gameOver': [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.25), i * 220)); break;
    }
  }
}
