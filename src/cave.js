// Jeskyně jako mřížka kostek 1×1×1 m. Čistá logika bez three.js — testuje se v Node.
//
// Každá úroveň = jedna velká komora (protáhlá dutina se zvlněnými stěnami)
// + tunel na konci, zatarasený dveřmi. Dveře zmizí, až padnou všichni nepřátelé.
import { makeRng, makeNoise3 } from './rng.js';

export const AIR = 0, ROCK = 1, DOOR = 2, LAVA = 3;

export class Cave {
  constructor(level, seed = 1234) {
    this.level = level;
    this.nx = 60; this.ny = 24; this.nz = 84;
    this.cells = new Uint8Array(this.nx * this.ny * this.nz).fill(ROCK);
    this.rng = makeRng(seed + level * 7919);
    this.noise = makeNoise3(seed + level * 104729);
    this.pillars = [];
    this.pools = [];
    this.carve();
  }

  idx(x, y, z) { return x + this.nx * (y + this.ny * z); }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : ROCK; }
  set(x, y, z, v) { if (this.inside(x, y, z)) this.cells[this.idx(x, y, z)] = v; }
  // pozice ve světě (metry) → je tam pevná hmota? (láva je „pevná“ — dá se na ni šlápnout)
  solidAt(px, py, pz) { return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) !== AIR; }
  lavaAt(px, py, pz) { return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) === LAVA; }

  carve() {
    const { nx, ny, nz, noise } = this;
    const cx = nx / 2, cy = ny * 0.45;
    // komora: rozlehlá dutina od z=3 do z=nz-10, šířka a výška se mění podél délky
    this.chamberZ0 = 3; this.chamberZ1 = nz - 10;
    for (let z = this.chamberZ0; z < this.chamberZ1; z++) {
      const t = (z - this.chamberZ0) / (this.chamberZ1 - this.chamberZ0);
      const bulge = Math.sin(t * Math.PI) ** 0.6;
      const rx = 9 + 17 * bulge + 2.5 * noise(z * 0.12, 3.1, 0);
      const ry = 5.5 + 5.5 * bulge + 1.2 * noise(z * 0.12, 7.7, 0);
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          const n = 0.25 * noise(x * 0.18, y * 0.18, z * 0.18);
          if (dx * dx + dy * dy < 1 + n) this.set(x, y, z, AIR);
        }
      }
    }
    // rovná podlaha kousek nad dnem, ať se dá přistát
    this.floorY = 3;
    for (let z = this.chamberZ0; z < this.chamberZ1; z++)
      for (let x = 1; x < nx - 1; x++)
        for (let y = 1; y < this.floorY; y++) this.set(x, y, z, ROCK);

    this.spawn = { x: cx, y: this.floorY + 0.01, z: this.chamberZ0 + 9 };
    const tx0 = Math.floor(cx) - 2;
    this.tunnel = { x0: tx0, x1: tx0 + 4, y0: this.floorY, y1: this.floorY + 4 };
    this.carvePillars();
    this.carveLava();

    // výstupní tunel 4×4 do konce mřížky a dveře v jeho ústí
    const ty0 = this.floorY;
    for (let z = this.chamberZ1 - 4; z < nz - 1; z++)
      for (let y = ty0; y < ty0 + 4; y++)
        for (let x = tx0; x < tx0 + 4; x++) this.set(x, y, z, AIR);
    this.doorZ = this.chamberZ1 + 1;
    for (let y = ty0; y < ty0 + 4; y++)
      for (let x = tx0; x < tx0 + 4; x++) this.set(x, y, this.doorZ, DOOR);
    this.exitZ = nz - 3;     // proletí-li hráč sem, úroveň končí
    // volno kolem startu i za zády (místo pro kameru)
    for (let z = this.chamberZ0 + 3; z <= this.spawn.z + 2; z++)
      this.ensureClear({ x: cx, y: this.floorY, z }, 2, 5);
  }

  // výška stropu nad podlahou v daném sloupci (první pevná kostka nad podlahou)
  ceilingAt(x, z) {
    for (let y = this.floorY; y < this.ny; y++) if (this.get(x, y, z) !== AIR) return y;
    return this.ny;
  }

  // místo na podlaze mimo start a cestu k východu?
  freeFloor(x, z, margin) {
    const s = this.spawn;
    if (Math.hypot(x - s.x, z - s.z) < 6 + margin) return false;
    if (z > this.chamberZ1 - 8 - margin && Math.abs(x - s.x) < 5 + margin) return false;
    return this.get(Math.floor(x), this.floorY, Math.floor(z)) === AIR &&
           this.get(Math.floor(x), this.floorY - 1, Math.floor(z)) === ROCK;
  }

  // krápníky: sloupy od podlahy ke stropu (úkryt), stalagmity a stalaktity
  carvePillars() {
    const want = Math.min(28, 16 + 2 * this.level);
    for (let tries = 0; tries < 400 && this.pillars.length < want; tries++) {
      const px = this.rng.range(4, this.nx - 5), pz = this.rng.range(this.chamberZ0 + 12, this.chamberZ1 - 6);
      if (!this.freeFloor(px, pz, 1)) continue;
      if (this.pillars.some((p) => Math.hypot(p.x - px, p.z - pz) < p.r + 4)) continue;
      const top = this.ceilingAt(Math.floor(px), Math.floor(pz));
      const height = top - this.floorY;
      if (height < 5) continue;
      const roll = this.rng();
      const kind = roll < 0.45 ? 'sloup' : roll < 0.75 ? 'stalagmit' : 'stalaktit';
      const r = kind === 'sloup' ? this.rng.range(1.2, 2.3) : this.rng.range(0.9, 1.8);
      const len = kind === 'sloup' ? height : Math.min(height - 3, this.rng.int(3, 8));
      this.pillars.push({ x: px, z: pz, r, kind });
      for (let i = 0; i < len; i++) {
        const y = kind === 'stalaktit' ? top - 1 - i : this.floorY + i;
        const t = i / Math.max(1, len - 1);
        // sloup je v půlce užší (přesýpací hodiny), krápník se zužuje ke špičce
        const shape = kind === 'sloup' ? 0.75 + 0.25 * Math.abs(2 * t - 1) : 1 - 0.8 * t;
        const rr = r * shape * (1 + 0.15 * this.noise(px, y * 0.4, pz));
        for (let x = Math.floor(px - rr); x <= Math.ceil(px + rr); x++)
          for (let z = Math.floor(pz - rr); z <= Math.ceil(pz + rr); z++)
            if ((x + 0.5 - px) ** 2 + (z + 0.5 - pz) ** 2 <= rr * rr) this.set(x, y, z, ROCK);
      }
    }
  }

  // lávová jezírka v horní vrstvě podlahy; s úrovní jich přibývá a rostou
  carveLava() {
    const count = Math.min(9, 1 + this.level);
    const radius = Math.min(5.5, 1.2 + 0.55 * this.level);
    let floorCells = 0;
    for (let z = this.chamberZ0; z < this.chamberZ1; z++)
      for (let x = 1; x < this.nx - 1; x++)
        if (this.get(x, this.floorY, z) === AIR) floorCells++;
    const maxLava = floorCells * 0.3;       // podlaha nikdy nezmizí celá
    let lava = 0;
    for (let tries = 0; tries < 300 && this.pools.length < count; tries++) {
      const px = this.rng.range(5, this.nx - 6), pz = this.rng.range(this.chamberZ0 + 12, this.chamberZ1 - 8);
      const r = radius * this.rng.range(0.7, 1.2);
      if (!this.freeFloor(px, pz, r)) continue;
      const cells = [];
      for (let x = Math.floor(px - r - 1); x <= Math.ceil(px + r + 1); x++)
        for (let z = Math.floor(pz - r - 1); z <= Math.ceil(pz + r + 1); z++) {
          const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz) / r;
          if (d < 1 + 0.35 * this.noise(x * 0.5, 1.7, z * 0.5) && this.freeFloor(x + 0.5, z + 0.5, 0))
            cells.push([x, z]);
        }
      if (!cells.length || lava + cells.length > maxLava) continue;
      for (const [x, z] of cells) this.set(x, this.floorY - 1, z, LAVA);
      lava += cells.length;
      this.pools.push({ x: px, z: pz, r, cells: cells.length });
    }
    this.lavaCells = lava;
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
      if (this.get(x, y, z) === AIR && this.get(x, y + 1, z) === AIR && this.get(x, y - 1, z) === ROCK)
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
