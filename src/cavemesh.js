// Jeskyně jako JEDEN model složený jen z viditelných stěn kostek (stěna, za
// kterou je vzduch). Obrovská síň má desítky tisíc povrchových kostek; kreslit
// je celé by bylo na Questu příliš (každá kostka 12 trojúhelníků), takhle
// vychází zhruba 1–2 stěny na kostku a vše je v jediném volání kreslení.
import * as THREE from 'three';
import { AIR, ROCK } from './cave.js';

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

export function buildCaveGeometry(cave) {
  const pos = [], nrm = [], col = [], idx = [];
  const c = new THREE.Color();
  const { nx, ny, nz } = cave;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (cave.get(x, y, z) !== ROCK) continue;
        const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
        FACES.forEach(([d, corners], fi) => {
          if (cave.get(x + d[0], y + d[1], z + d[2]) !== AIR) return;
          let hex = PALETTE[h % 4];
          if (fi === 2 && h % 3 === 0) hex = PALETTE[4];        // zlatavé vršky
          if (fi !== 2 && h % 7 === 0) hex = PALETTE[5];
          c.setHex(hex).multiplyScalar(SHADE[fi]);
          const base = pos.length / 3;
          for (const [cx, cy, cz] of corners) {
            pos.push(x + cx, y + cy, z + cz);
            nrm.push(d[0], d[1], d[2]);
            col.push(c.r, c.g, c.b);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        });
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
