// Jeskyně jako mřížka kostek 1×1×1 m. Čistá logika bez three.js — testuje se v Node.
//
// Každá úroveň = jedna velká komora (protáhlá dutina se zvlněnými stěnami)
// + tunel na konci, zatarasený dveřmi. Dveře zmizí, až padnou všichni nepřátelé.
import { makeRng, makeNoise3 } from './rng.js';

export const AIR = 0, ROCK = 1, DOOR = 2;

export class Cave {
  constructor(level, seed = 1234) {
    this.level = level;
    this.nx = 34; this.ny = 20; this.nz = 50;
    this.cells = new Uint8Array(this.nx * this.ny * this.nz).fill(ROCK);
    this.rng = makeRng(seed + level * 7919);
    this.noise = makeNoise3(seed + level * 104729);
    this.carve();
  }

  idx(x, y, z) { return x + this.nx * (y + this.ny * z); }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : ROCK; }
  set(x, y, z, v) { if (this.inside(x, y, z)) this.cells[this.idx(x, y, z)] = v; }
  // pozice ve světě (metry) → je tam pevná hmota?
  solidAt(px, py, pz) { return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) !== AIR; }

  carve() {
    const { nx, ny, nz, noise } = this;
    const cx = nx / 2, cy = ny * 0.45;
    // komora: od z=3 do z=nz-10, poloměry se mění podél délky
    this.chamberZ0 = 3; this.chamberZ1 = nz - 10;
    for (let z = this.chamberZ0; z < this.chamberZ1; z++) {
      const t = (z - this.chamberZ0) / (this.chamberZ1 - this.chamberZ0);
      const bulge = Math.sin(t * Math.PI);
      const rx = 7 + 7 * bulge + 1.5 * noise(z * 0.15, 3.1, 0);
      const ry = 4.5 + 4 * bulge + 1.0 * noise(z * 0.15, 7.7, 0);
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          const n = 0.28 * noise(x * 0.22, y * 0.22, z * 0.22);
          if (dx * dx + dy * dy < 1 + n) this.set(x, y, z, AIR);
        }
      }
    }
    // rovná podlaha kousek nad dnem, ať se dá přistát
    this.floorY = 3;
    for (let z = this.chamberZ0; z < this.chamberZ1; z++)
      for (let x = 1; x < nx - 1; x++)
        for (let y = 1; y < this.floorY; y++) this.set(x, y, z, ROCK);
    // skalní pilíře a výběžky — překážky při letu
    const pillars = 3 + Math.min(this.level, 5);
    for (let i = 0; i < pillars; i++) {
      const px = this.rng.int(6, nx - 7), pz = this.rng.int(this.chamberZ0 + 16, this.chamberZ1 - 6);
      const r = this.rng.range(0.8, 1.8), h = this.rng.int(3, 8);
      const fromCeiling = this.rng() < 0.4;
      for (let y = 0; y < h; y++) {
        const yy = fromCeiling ? ny - 2 - y : this.floorY + y;
        const rr = r * (1 - y / (h * 1.6));
        for (let x = Math.floor(px - rr); x <= Math.ceil(px + rr); x++)
          for (let z = Math.floor(pz - rr); z <= Math.ceil(pz + rr); z++)
            if ((x - px) ** 2 + (z - pz) ** 2 <= rr * rr) this.set(x, yy, z, ROCK);
      }
    }
    // výstupní tunel 4×4 do konce mřížky a dveře v jeho ústí
    const tx0 = Math.floor(cx) - 2, ty0 = this.floorY;
    this.tunnel = { x0: tx0, x1: tx0 + 4, y0: ty0, y1: ty0 + 4 };
    for (let z = this.chamberZ1 - 4; z < nz - 1; z++)
      for (let y = ty0; y < ty0 + 4; y++)
        for (let x = tx0; x < tx0 + 4; x++) this.set(x, y, z, AIR);
    this.doorZ = this.chamberZ1 + 1;
    for (let y = ty0; y < ty0 + 4; y++)
      for (let x = tx0; x < tx0 + 4; x++) this.set(x, y, this.doorZ, DOOR);
    this.exitZ = nz - 3;     // proletí-li hráč sem, úroveň končí
    // start: začátek komory na podlaze uprostřed
    this.spawn = { x: cx, y: this.floorY + 0.01, z: this.chamberZ0 + 9 };
    // volno kolem startu i za zády (místo pro kameru)
    for (let z = this.chamberZ0 + 3; z <= this.spawn.z + 2; z++)
      this.ensureClear({ x: cx, y: this.floorY, z }, 2, 5);
  }

  ensureClear(p, r, h) {
    for (let y = Math.floor(p.y); y < Math.floor(p.y) + h; y++)
      for (let x = Math.floor(p.x - r); x <= Math.floor(p.x + r); x++)
        this.set(x, y, Math.floor(p.z), AIR);
  }

  openDoor() {
    const changed = [];
    for (let z = 0; z < this.nz; z++)
      for (let y = 0; y < this.ny; y++)
        for (let x = 0; x < this.nx; x++)
          if (this.get(x, y, z) === DOOR) { this.set(x, y, z, AIR); changed.push([x, y, z]); }
    return changed;
  }

  // náhodné volné místo ve vzduchu (pro nepřátele, kanystry)
  randomAirSpot(minZ, maxZ, clearance = 1, minY = null) {
    for (let tries = 0; tries < 500; tries++) {
      const x = this.rng.int(2, this.nx - 3), z = this.rng.int(minZ, maxZ);
      const y = this.rng.int(minY ?? this.floorY + 1, this.ny - 3);
      let ok = true;
      for (let dx = -clearance; dx <= clearance && ok; dx++)
        for (let dy = -clearance; dy <= clearance && ok; dy++)
          for (let dz = -clearance; dz <= clearance && ok; dz++)
            if (this.get(x + dx, y + dy, z + dz) !== AIR) ok = false;
      if (ok) return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    }
    return null;
  }

  // místo na podlaze (pro kanystry paliva)
  floorSpot(minZ, maxZ) {
    for (let tries = 0; tries < 300; tries++) {
      const x = this.rng.int(3, this.nx - 4), z = this.rng.int(minZ, maxZ);
      const y = this.floorY;
      if (this.get(x, y, z) === AIR && this.get(x, y + 1, z) === AIR && this.get(x, y - 1, z) !== AIR)
        return { x: x + 0.5, y: y, z: z + 0.5 };
    }
    return null;
  }

  // kostky, které sousedí se vzduchem (jen ty má smysl kreslit)
  surfaceCells() {
    const out = [];
    const { nx, ny, nz } = this;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const v = this.get(x, y, z);
          if (v === AIR) continue;
          if (this.get(x + 1, y, z) === AIR || this.get(x - 1, y, z) === AIR ||
              this.get(x, y + 1, z) === AIR || this.get(x, y - 1, z) === AIR ||
              this.get(x, y, z + 1) === AIR || this.get(x, y, z - 1) === AIR)
            out.push([x, y, z, v]);
        }
    return out;
  }

  // Úsečka a→b: první pevný bod (krok 0.1 m), nebo null.
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
