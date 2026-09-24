// Testy herní logiky (bez prohlížeče): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cave, AIR, DOOR } from '../src/cave.js';
import { moveBox } from '../src/physics.js';
import { World, setClock, forwardOf, rightOf } from '../src/world.js';
import { mapXRSources } from '../src/input.js';
import { CFG } from '../src/config.js';

let now = 0;
setClock(() => now);
const step = (w, input, secs) => { for (let i = 0; i < secs * 60; i++) { now += 1 / 60; w.update(input, 1 / 60); } };
const newWorld = (seed = 7) => { const w = new World(seed); w.newGame(); return w; };

test('jeskyně: start je volný, dveře blokují tunel, po otevření je průchod', () => {
  for (const lvl of [1, 2, 5]) {
    const c = new Cave(lvl, 99);
    const s = c.spawn;
    for (let y = 0; y < 3; y++) assert.equal(c.get(Math.floor(s.x), Math.floor(s.y) + y, Math.floor(s.z)), AIR);
    assert.equal(c.get(c.tunnel.x0 + 1, c.tunnel.y0 + 1, c.doorZ), DOOR);
    assert.ok(c.openDoor().length > 0);
    for (let z = s.z; z < c.exitZ; z++) assert.equal(c.get(c.tunnel.x0 + 1, c.tunnel.y0 + 1, Math.floor(z)) !== 1 || z < c.chamberZ1 - 4, true);
  }
});

test('jeskyně: stejné semínko = stejná úroveň', () => {
  assert.deepEqual(new Cave(3, 5).cells, new Cave(3, 5).cells);
  assert.notDeepEqual(new Cave(3, 5).cells, new Cave(4, 5).cells);
});

test('fyzika: pád se zastaví na podlaze, stěna zastaví pohyb', () => {
  const c = new Cave(1, 1);
  const pos = { x: c.spawn.x, y: c.spawn.y + 3, z: c.spawn.z }, vel = { x: 0, y: -10, z: 0 };
  let r;
  for (let i = 0; i < 120; i++) r = moveBox(c, pos, vel, { w: 0.7, h: 1.8 }, 1 / 60);
  assert.ok(r.onGround);
  assert.equal(pos.y, c.floorY);
  const p2 = { x: 2.5, y: c.floorY, z: 20 }, v2 = { x: -30, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) moveBox(c, p2, v2, { w: 0.7, h: 1.8 }, 1 / 60);
  assert.ok(p2.x > 1, 'neprošel stěnou');
});

test('směry: dopředu/doprava pro natočení 0 a 90°', () => {
  assert.deepEqual(Object.values(forwardOf(0)).map(Math.round), [0, 0, 1]);
  assert.deepEqual(Object.values(rightOf(0)).map(Math.round), [-1, 0, 0]);
  const f = forwardOf(Math.PI / 2);
  assert.ok(Math.abs(f.x - 1) < 1e-9);
});

test('hráč: chůze dopředu, plynulé otáčení, jetpack bere palivo, na zemi se doplňuje', () => {
  const w = newWorld();
  step(w, {}, 0.5);
  const z0 = w.player.pos.z;
  step(w, { moveY: 1 }, 1);
  assert.ok(w.player.pos.z > z0 + 3, 'ušel aspoň 3 m');
  const yaw0 = w.player.yaw;
  step(w, { turn: 0.5 }, 0.5);
  assert.ok(Math.abs(w.player.yaw - (yaw0 - 0.5 * CFG.player.turnSpeed * 0.5)) < 0.02, 'plynulé otáčení úměrné páčce');
  const y0 = w.player.pos.y, f0 = w.player.fuel;
  step(w, { thrust: 1 }, 1);
  assert.ok(w.player.pos.y > y0 + 2, 'vzlétl');
  assert.ok(w.player.fuel < f0 - 15, 'spotřeboval palivo');
  step(w, {}, 3);
  const f1 = w.player.fuel;
  step(w, {}, 2);
  assert.ok(w.player.onGround && w.player.fuel > f1, 'na zemi se palivo doplňuje');
});

test('hráč: bez paliva jetpack nezvedne', () => {
  const w = newWorld();
  step(w, {}, 0.5);
  w.player.fuel = 0;
  const y0 = w.player.pos.y;
  step(w, { thrust: 1 }, 1);
  assert.ok(w.player.pos.y <= y0 + 0.01);
});

test('boj: střela zabije příšeru, po zabití všech se otevřou dveře, průlet dokončí úroveň', () => {
  const w = newWorld();
  const e = w.enemies[0];
  const m = w.gunMuzzle();
  e.pos = { x: m.x, y: m.y, z: m.z + 4 };
  e.speed = 0;
  w.enemies.slice(1).forEach((x) => (x.hp = 0));
  for (let i = 0; i < 90 && e.hp > 0; i++) { now += 1 / 60; e.pos = { x: w.gunMuzzle().x, y: w.gunMuzzle().y, z: w.gunMuzzle().z + 4 }; w.update({ fire: true, aimDir: { x: 0, y: 0, z: 1 } }, 1 / 60); }
  assert.equal(e.hp <= 0, true, 'příšera padla');
  assert.equal(w.score, CFG.score.kill);
  step(w, {}, 0.1);
  assert.ok(w.doorOpen);
  // plynulý přechod: průlet tunelem do další (už připravené) jeskyně
  const c1 = w.cur, c2 = w.next;
  assert.ok(c2 && c2.added, 'další jeskyně je napojená na řetěz');
  assert.equal(c2.oz, c1.oz + c1.nz);
  const tx = c1.tunnel.x0 + 2;
  for (let z = c1.oz + c1.doorZ; z < c2.oz + c2.chamberZ0 + 2; z++)
    assert.equal(w.cave.get(tx, c1.floorY + 1, z), 0, 'tunel průchozí v z=' + z);
  w.player.pos = { x: tx, y: c1.floorY, z: c2.oz + c2.chamberZ0 + 2 };
  step(w, {}, 0.05);
  assert.equal(w.state, 'playing', 'žádná pauza');
  assert.equal(w.level, 2);
  assert.equal(w.cur, c2);
  assert.ok(w.boss, '2. úroveň je s bossem');
  assert.equal(w.enemies.length, 1, 'v úrovni s bossem jen boss');
  assert.ok(w.enemies.every((e) => e.pos.z > c2.oz), 'boss je v nové jeskyni');
  assert.ok(w.score >= CFG.score.kill + CFG.score.levelBonus);
  // stará jeskyně zmizí, až je hráč hluboko v nové, a vstup se zazdí
  assert.ok(w.cave.caves.includes(c1));
  w.player.pos = { x: tx, y: c2.floorY, z: c2.oz + c2.chamberZ0 + 20 };
  step(w, {}, 0.05);
  assert.ok(!w.cave.caves.includes(c1), 'stará jeskyně zahozena');
  assert.equal(w.cave.get(tx, c2.floorY + 1, c2.oz), 1, 'vstup zazděn');
});

test('další jeskyně se staví postupně na pozadí', () => {
  const w = newWorld(3);
  assert.ok(w.next && !w.next.added);
  let steps = 0;
  while (!w.next.added && steps < 5000) { w.buildStep(0); steps++; }
  assert.ok(w.next.added && steps > 10, 'stavba po kouscích (' + steps + ' kroků)');
  assert.ok(w.events.some((e) => e.type === 'caveReady'));
});

test('zásahy: kontakt s příšerou ubere život, pak chvíli nesmrtelnost, 0 životů = konec', () => {
  const w = newWorld();
  step(w, {}, 1.2);                     // uplyne ochrana po startu
  const e = w.enemies[0];
  const hit = () => { e.pos = { x: w.player.pos.x, y: w.player.pos.y + 1, z: w.player.pos.z }; e.speed = 0; now += 1 / 60; w.update({}, 1 / 60); };
  hit();
  assert.equal(w.player.lives, CFG.player.lives - 1);
  hit();
  assert.equal(w.player.lives, CFG.player.lives - 1, 'nesmrtelnost');
  w.player.lives = 1; w.player.invuln = 0;
  hit();
  assert.equal(w.state, 'gameover');
});

test('kanystr doplní palivo', () => {
  const w = newWorld();
  const k = w.pickups[0];
  assert.ok(k);
  w.player.fuel = 10;
  w.player.pos = { x: k.pos.x, y: k.pos.y, z: k.pos.z };
  step(w, {}, 0.05);
  assert.ok(k.taken && w.player.fuel >= 10 + CFG.pickup.fuel - 1);
});

test('ovladače Questu: levá páčka pohyb, pravá otáčení, spouště jetpack a střelba', () => {
  const gp = (axes, buttons) => ({ axes, buttons: buttons.map((v) => ({ value: v, pressed: v > 0.5 })) });
  const inp = mapXRSources([
    { handedness: 'left', gamepad: gp([0, 0, 0.5, -1], [0.8, 0, 0, 0, 0, 0]) },
    { handedness: 'right', gamepad: gp([0, 0, -1, 0], [1, 0, 0, 0, 1, 0]) },
  ]);
  assert.ok(inp.moveY > 0.99 && inp.moveX > 0.3 && inp.moveX < 0.5);
  assert.equal(inp.thrust, 0.8);
  assert.ok(inp.turn < -0.99);
  assert.equal(inp.fire, true);
  assert.equal(inp.start, true);
  const idle = mapXRSources([{ handedness: 'left', gamepad: gp([0, 0, 0.1, -0.1], [0, 0]) }]);
  assert.equal(idle.moveX, 0, 'mrtvá zóna');
  assert.equal(idle.moveY, 0);
});

import { LAVA, ROCK } from '../src/cave.js';

test('jeskyně: obrovská síň, krápníků s úrovní ubývá (1. úroveň 5, od 6. žádné)', () => {
  const c = new Cave(1, 42);
  assert.ok(c.nx >= 100 && c.nz >= 140, 'rozměry');
  let maxH = 0;
  for (let z = c.chamberZ0; z < c.chamberZ1; z += 5) maxH = Math.max(maxH, c.ceilingAt(Math.floor(c.nx / 2), z) - c.floorY);
  assert.ok(maxH >= 30, 'strop aspoň 30 m nad podlahou (je ' + maxH + ')');
  assert.equal(c.pillars.length, 5);
  const counts = [1, 2, 3, 4, 5, 6, 8, 12].map((l) => new Cave(l, 42).pillars.length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1], 'neubývají: ' + counts);
  assert.equal(new Cave(6, 42).pillars.length, 0);
  assert.equal(new Cave(12, 42).pillars.length, 0);
  for (const p of c.pillars.filter((p) => p.kind === 'sloup'))
    assert.equal(c.get(Math.floor(p.x), c.floorY, Math.floor(p.z)), ROCK, 'sloup stojí na podlaze');
});

test('láva: s úrovní roste, nikdy u startu, u východu ani pod kanystrem, max 30 % podlahy', () => {
  const lavaOf = (lvl) => { let n = 0; for (let s = 1; s <= 5; s++) n += new Cave(lvl, s * 11).lavaCells; return n; };
  assert.ok(lavaOf(1) > 0, 'láva už v 1. úrovni');
  assert.ok(lavaOf(4) > lavaOf(1) * 2, 've 4. úrovni víc lávy');
  assert.ok(lavaOf(8) > lavaOf(4), 'v 8. úrovni ještě víc');
  for (const lvl of [1, 5, 12]) {
    const c = new Cave(lvl, 3);
    const s = c.spawn;
    let floor = 0;
    for (let z = c.chamberZ0; z < c.chamberZ1; z++)
      for (let x = 1; x < c.nx - 1; x++) {
        if (c.get(x, c.floorY, z) === 0) floor++;
        if (c.get(x, c.floorY - 1, z) !== LAVA) continue;
        assert.ok(Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z) >= 6, 'láva u startu');
        assert.ok(!(z > c.chamberZ1 - 8 && Math.abs(x - s.x) < 5), 'láva na cestě k východu');
        assert.ok(c.ceilingAt(x, z) - c.floorY >= 6, 'nad lávou je místo k vyletění');
      }
    assert.ok(c.lavaCells <= floor * 0.3 + 1);
  }
  const w = new World(5); w.newGame(); w.nextLevel(); w.nextLevel(); w.nextLevel();
  assert.ok(w.pickups.length > 0);
  for (const k of w.pickups)
    assert.equal(w.cave.get(Math.floor(k.pos.x), w.cave.floorY - 1, Math.floor(k.pos.z)), ROCK, 'kanystr není na lávě');
});

test('láva: šlápnutí vezme život a vymrští hráče nahoru', () => {
  const w = new World(9); w.newGame();
  for (let i = 0; i < 4; i++) w.nextLevel();
  w.enemies.forEach((e) => { e.hp = 0; });
  const c = w.cur;
  let spot = null;
  for (let z = c.chamberZ0; z < c.chamberZ1 && !spot; z++)
    for (let x = 1; x < c.nx - 1 && !spot; x++)
      if (c.get(x, c.floorY - 1, z) === LAVA && c.get(x + 1, c.floorY - 1, z) === LAVA &&
          c.get(x, c.floorY - 1, z + 1) === LAVA && c.get(x + 1, c.floorY - 1, z + 1) === LAVA) spot = { x: x + 1, z: z + 1 };
  assert.ok(spot, 'v 5. úrovni je jezírko');
  w.player.invuln = 0;
  w.player.pos = { x: spot.x, y: c.floorY + 0.5, z: spot.z + c.oz };
  w.player.vel = { x: 0, y: -2, z: 0 };
  const lives = w.player.lives;
  step(w, {}, 0.3);
  assert.equal(w.player.lives, lives - 1);
  assert.ok(w.player.pos.y > c.floorY + 0.5, 'vymrštěn vzhůru');
});

test('příšera za sloupem nestřílí, s výhledem ano', () => {
  const w = new World(21); w.newGame(); w.nextLevel(); w.nextLevel();   // 3. úroveň: běžné příšery, střílí
  const c = w.cur;
  assert.ok(!w.boss);
  const lc = c.pillars.find((p) => p.kind === 'sloup' && p.r > 1.5) || c.pillars.find((p) => p.kind === 'sloup') || c.pillars[0];
  assert.ok(lc, 've 3. úrovni je krápník');
  const col = { ...lc, z: lc.z + c.oz };
  const e = w.enemies[0];
  w.enemies.slice(1).forEach((x) => { x.hp = 0; });
  Object.assign(e, { shooter: true, awake: true, speed: 0 });
  const behind = { x: col.x, y: c.floorY + 2, z: col.z + col.r + 3 };
  const place = (ez) => { e.pos = { x: col.x, y: c.floorY + 1.8, z: ez }; e.vel = { x: 0, y: 0, z: 0 }; };
  w.player.pos = { x: behind.x, y: c.floorY, z: col.z - col.r - 3 };
  w.player.invuln = 99;
  let shots = 0;
  for (let i = 0; i < 120; i++) { place(behind.z); e.shotTimer = 0; w.events.length = 0; now += 1 / 60; w.update({}, 1 / 60);
    shots += w.events.filter((x) => x.type === 'enemyShot').length; }
  assert.equal(shots, 0, 'přes sloup nestřílí');
  for (let i = 0; i < 30; i++) { e.pos = { x: w.player.pos.x + 4, y: c.floorY + 1.8, z: w.player.pos.z }; e.shotTimer = 0;
    w.events.length = 0; now += 1 / 60; w.update({}, 1 / 60); shots += w.events.filter((x) => x.type === 'enemyShot').length; }
  assert.ok(shots > 0, 's výhledem střílí');
});


// ── boss ──────────────────────────────────────────────────────────────────
const bossWorld = () => { const w = new World(8); w.newGame(); w.nextLevel(); w.player.invuln = 1e9; return w; };
// vystřel přímo do bosse a nech střelu doletět
const shootBoss = (w) => {
  const b = w.boss, m = w.gunMuzzle();
  b.pos = { x: m.x, y: m.y, z: m.z + 6 }; b.vel = { x: 0, y: 0, z: 0 };
  // příšerky odlétnou stranou, ať nechytají střely určené bossovi
  w.enemies.forEach((e) => { if (e.minion && e.hp > 0) e.pos = { x: m.x + 30, y: m.y + 10, z: m.z }; });
  w.fire();
  for (let k = 0; k < 20; k++) { now += 1 / 60; w.updateBullets(1 / 60); }
};

test('boss jen v každé druhé úrovni', () => {
  const w = new World(8); w.newGame();
  const seen = [];
  for (let l = 1; l <= 6; l++) { seen.push(!!w.boss); if (l < 6) w.nextLevel(); }
  assert.deepEqual(seen, [false, true, false, true, false, true]);
});

test('boss: zásah = −1 % zdraví a jedna nová příšerka', () => {
  const w = bossWorld();
  assert.equal(w.bossPct, 100);
  shootBoss(w);
  assert.equal(w.bossPct, 99);
  assert.equal(w.enemies.filter((e) => e.minion && e.hp > 0).length, 1);
  for (let i = 0; i < 4; i++) shootBoss(w);
  assert.equal(w.bossPct, 95);
  assert.equal(w.enemies.filter((e) => e.minion && e.hp > 0).length, 5);
  assert.ok(w.events.some((e) => e.type === 'minionSpawn'));
});

test('boss: nejvýš 20 příšerek naráz, zdraví ubírá dál', () => {
  const w = bossWorld();
  for (let i = 0; i < 30; i++) shootBoss(w);
  assert.equal(w.bossPct, 70);
  assert.equal(w.enemies.filter((e) => e.minion && e.hp > 0).length, CFG.boss.maxMinions);
});

test('boss: po smrti padnou i jeho příšerky a otevře se průchod', () => {
  const w = bossWorld();
  for (let i = 0; i < CFG.boss.hp; i++) shootBoss(w);
  assert.equal(w.boss.hp, 0);
  assert.equal(w.enemiesLeft, 0, 'žádná příšerka nepřežila');
  assert.ok(w.events.some((e) => e.type === 'bossKill'));
  w.update({}, 1 / 60);
  assert.ok(w.doorOpen);
  assert.ok(w.score >= CFG.score.boss);
});

test('boss: dokud žije, průchod je zavřený; střílí dávky', () => {
  const w = bossWorld();
  const b = w.boss;
  w.player.pos = { x: b.pos.x, y: w.cave.floorY, z: b.pos.z - 14 };
  let volleys = 0;
  for (let i = 0; i < 60 * 8; i++) { now += 1 / 60; w.update({}, 1 / 60); volleys += w.events.filter((e) => e.type === 'bossVolley').length; w.events.length = 0; }
  assert.ok(!w.doorOpen);
  assert.ok(b.awake);
  assert.ok(volleys >= 1, 'boss vystřelil aspoň jednu dávku');
});
