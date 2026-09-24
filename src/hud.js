// Panel s údaji ve stylu návrhu (retro řádky: životy, skóre, palivo, nejlepší)
// a banner se zprávami. Oboje kreslí do <canvas>: na počítači se zobrazí jako
// překryv stránky, ve VR jako textura na panelu před hráčem.
import * as THREE from 'three';
import { CFG } from './config.js';

const pad = (n, w = 5) => String(Math.max(0, Math.round(n))).padStart(w, '0');

export class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 300;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.last = '';
  }

  draw(world, high) {
    const p = world.player;
    const key = [p.lives, world.score, Math.round(p.fuel), high, world.level, world.enemiesLeft, world.doorOpen].join('|');
    if (key === this.last) return;
    this.last = key;
    const c = this.ctx, W = this.canvas.width;
    c.clearRect(0, 0, W, 300);
    c.fillStyle = 'rgba(10, 8, 30, 0.82)';
    c.fillRect(0, 0, W, 300);
    const rows = [18, 112, 206];
    c.strokeStyle = '#7d8cff'; c.lineWidth = 4;
    for (const y of rows) { c.strokeRect(10, y, W - 20, 78); }
    c.font = 'bold 54px "Courier New", monospace';
    c.textBaseline = 'middle';
    const txt = (s, x, y, col) => { c.fillStyle = col; c.fillText(s, x, y); };
    // řádek 1: životy + skóre
    txt('♥ x ' + p.lives, 30, rows[0] + 40, '#ff5a7a');
    txt('SKÓRE', 360, rows[0] + 40, '#ffd84a');
    txt(pad(world.score), 790, rows[0] + 40, '#9fe8ff');
    // řádek 2: palivo s ukazatelem
    txt('PALIVO', 30, rows[1] + 40, '#ffd84a');
    const bx = 290, bw = 470, by = rows[1] + 16, bh = 48;
    c.fillStyle = '#5b2a91'; c.fillRect(bx, by, bw, bh);
    const f = p.fuel / CFG.player.fuelMax;
    c.fillStyle = f > 0.25 ? '#3fd0ff' : '#ff4fa0';
    c.fillRect(bx + 4, by + 4, (bw - 8) * f, bh - 8);
    txt(String(Math.round(p.fuel)).padStart(3, ' '), 800, rows[1] + 40, '#9fe8ff');
    // řádek 3: úroveň, nepřátelé, nejlepší skóre
    txt('LV' + world.level, 30, rows[2] + 40, '#63e36b');
    txt(world.doorOpen ? '▶ VÝCHOD' : '☻ ' + world.enemiesLeft, 190, rows[2] + 40,
        world.doorOpen ? '#63e36b' : '#b88cff');
    txt('NEJ', 520, rows[2] + 40, '#ffd84a');
    txt(pad(high), 790, rows[2] + 40, '#9fe8ff');
    this.texture.needsUpdate = true;
  }
}

export class Banner {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.until = 0;
    this.lines = [];
  }

  show(lines, seconds, now) {
    this.lines = Array.isArray(lines) ? lines : [lines];
    this.until = seconds > 0 ? now + seconds : Infinity;
    const c = this.ctx;
    c.clearRect(0, 0, 1024, 256);
    c.fillStyle = 'rgba(10, 8, 30, 0.8)';
    c.fillRect(0, 0, 1024, 256);
    c.strokeStyle = '#ffd84a'; c.lineWidth = 6; c.strokeRect(6, 6, 1012, 244);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const n = this.lines.length;
    this.lines.forEach((l, i) => {
      c.font = i === 0 ? 'bold 76px "Courier New", monospace' : 'bold 40px "Courier New", monospace';
      c.fillStyle = i === 0 ? '#ffd84a' : '#9fe8ff';
      c.fillText(l, 512, 128 + (i - (n - 1) / 2) * (n > 2 ? 64 : 80));
    });
    this.texture.needsUpdate = true;
  }

  hide() { this.until = 0; }
  visible(now) { return now < this.until; }
}
