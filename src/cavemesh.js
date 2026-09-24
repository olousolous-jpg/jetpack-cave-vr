// Jeskyně jako JEDEN model složený jen z viditelných stěn kostek (stěna, za
// kterou je vzduch). Obrovská síň má desítky tisíc povrchových kostek; kreslit
// je celé by bylo na Questu příliš (každá kostka 12 trojúhelníků), takhle
// vychází zhruba 1–2 stěny na kostku a vše je v jediném volání kreslení.
import * as THREE from 'three';
import { AIR, ROCK, DOOR, LAVA } from './cave.js';

// [směr souseda, normála, 4 rohy stěny (v jednotkách kostky)]
const FACES = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

// hnědé a zlaté odstíny jako v návrhu
const PALETTE = [0x8a5628, 0xa0662e, 0xb87a36, 0xd09444, 0xf0bc58, 0x6a4220];
const SHADE = [0.82, 0.82, 1.0, 0.55, 0.92, 0.92];   // jednoduché „stínování" podle strany

// Postupné sestavení (generátor): po pár řádcích `yield`, ať se další jeskyně
// dá připravit během hry bez záseku. Model je rozdělený na kusy po CHUNK řezech
// (kus mimo zorné pole se nekreslí). Zároveň posbírá kostky lávy, dveří a místa
// pro krystaly. Výsledek (return): { geometries, lava, door, crystals }.
const CHUNK = 10;

function makeGeometry(pos, nrm, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nrm), 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
  g.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

export function* buildCaveSteps(cave, rowsPerStep = 8) {
  const geometries = [];
  let pos = [], nrm = [], col = [], idx = [];
  const lava = [], door = [], crystals = [];
  const c = new THREE.Color();
  const { nx, ny, nz } = cave;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      // malé kroky (pár řádků řezu), ať ani pomalejší Quest nezadrhne
      if (y % rowsPerStep === rowsPerStep - 1) yield;
      for (let x = 0; x < nx; x++) {
        const v = cave.get(x, y, z);
        if (v === AIR) continue;
        if (v === LAVA) { if (cave.get(x, y + 1, z) === AIR) lava.push([x, y, z]); continue; }
        if (v === DOOR) { door.push([x, y, z]); continue; }
        const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
        if (y === cave.floorY - 1 && cave.get(x, y + 1, z) === AIR && h % 911 === 0) crystals.push([x, y, z]);
        for (let fi = 0; fi < 6; fi++) {
          const [d, corners] = FACES[fi];
          // stěna je vidět do vzduchu i do dveří (bariéra je průhledná a později zmizí)
          const nb = cave.get(x + d[0], y + d[1], z + d[2]);
          if (nb !== AIR && nb !== DOOR) continue;
          let hex = PALETTE[h % 4];
          if (fi === 2 && h % 3 === 0) hex = PALETTE[4];        // zlatavé vršky
          if (fi !== 2 && h % 7 === 0) hex = PALETTE[5];
          c.setHex(hex).multiplyScalar(SHADE[fi]);
          const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
          const base = pos.length / 3;
          for (const [cx, cy, cz] of corners) {
            pos.push(x + cx, y + cy, z + cz);
            nrm.push(d[0] * 127, d[1] * 127, d[2] * 127);
            col.push(r, g, b);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    if ((z + 1) % CHUNK === 0 || z === nz - 1) {
      if (idx.length) geometries.push(makeGeometry(pos, nrm, col, idx));
      pos = []; nrm = []; col = []; idx = [];
      yield;
    }
  }
  return { geometries, lava, door, crystals: crystals.slice(0, 40) };
}

export function buildCaveGeometry(cave) {
  const it = buildCaveSteps(cave);
  let r;
  while (!(r = it.next()).done);
  return r.value.geometries;
}
