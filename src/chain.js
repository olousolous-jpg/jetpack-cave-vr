// Řetěz jeskyní za sebou podél osy z. Fyzika, míření a kamera se ptají řetězu
// (SVĚTOVÉ souřadnice) a ten dotaz předá jeskyni, do které bod patří. Mimo
// všechny jeskyně je pevná skála.
import { AIR, ROCK, LAVA } from './cave.js';

export class CaveChain {
  constructor() { this.caves = []; this.floorY = 3; }

  add(cave) {
    this.caves.push(cave);
    this.caves.sort((a, b) => a.oz - b.oz);
    this.floorY = cave.floorY;
    this.nx = cave.nx;
  }

  remove(cave) { this.caves = this.caves.filter((c) => c !== cave); }

  caveAt(z) {
    for (const c of this.caves) if (z >= c.oz && z < c.oz + c.nz) return c;
    return null;
  }

  get(x, y, z) {
    const c = this.caveAt(z);
    return c ? c.get(x, y, z - c.oz) : ROCK;
  }

  solidAt(px, py, pz) { return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) !== AIR; }
  lavaAt(px, py, pz) { return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) === LAVA; }

  // Úsečka a→b: první pevný bod, nebo null (stejné jako Cave.raycast, ale ve světě).
  raycast(ax, ay, az, bx, by, bz, step = 0.1) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (this.solidAt(x, y, z)) return { x, y, z, t, dist: len * t };
    }
    return null;
  }
}
