// Herní logika bez vykreslování: hráč, nepřátelé, střely, palivo, úrovně.
// Scéna (scene.js) jen čte stav a kreslí; zvuky a efekty reagují na `events`.
import { Cave, ROCK } from './cave.js';
import { CaveChain } from './chain.js';
import { moveBox } from './physics.js';
import { CFG } from './config.js';
import { makeRng } from './rng.js';

const P = CFG.player;

export function forwardOf(yaw) { return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }; }
export function rightOf(yaw) { return { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) }; }
const len = (v) => Math.hypot(v.x, v.y, v.z);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export class World {
  constructor(seed = Date.now() % 100000) {
    this.seed = seed;
    this.rng = makeRng(seed ^ 0x5bd1e995);
    this.score = 0;
    this.level = 0;
    this.events = [];
    this.state = 'menu';            // menu | playing | gameover
    this.player = {
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, fuel: P.fuelMax, lives: P.lives, invuln: 0,
      onGround: false, thrusting: 0, cooldown: 0, aim: { x: 0, y: 0, z: 1 },
    };
    this.newGame();
    this.state = 'menu';
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  newGame() {
    this.score = 0;
    this.player.lives = P.lives;
    this.level = 1;
    // řetěz jeskyní: aktuální (cur), připravovaná další (next), opouštěná (prev)
    this.cave = new CaveChain();
    this.cur = new Cave(1, this.seed);
    this.cave.add(this.cur);
    this.prev = null;
    this.next = null;
    const p = this.player;
    p.pos = this.toWorld(this.cur.spawn);
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = 0;                       // jeskyně vede ve směru +z
    p.invuln = 1.0;
    this.bullets = [];
    this.shots = [];                 // střely nepřátel
    this.populateLevel();
    this.startPending();
    this.state = 'playing';
    this.emit('newGame');
  }

  toWorld(p, cave = this.cur) { return { x: p.x, y: p.y, z: p.z + cave.oz }; }

  // příšery, kanystry a plná nádrž pro aktuální jeskyni
  isBossLevel(n = this.level) { return n % CFG.boss.everyNth === 0; }

  populateLevel() {
    const n = this.level, c = this.cur, E = CFG.enemy, B = CFG.boss;
    this.player.fuel = P.fuelMax;
    this.enemies = [];
    this.boss = null;
    if (this.isBossLevel(n)) {
      // boss se vznáší uprostřed síně, vysoko nad podlahou
      const mid = Math.floor((c.chamberZ0 + c.chamberZ1) / 2);
      const top = c.ceilingAt(Math.floor(c.nx / 2), mid);
      const pos = this.toWorld({ x: c.nx / 2, y: Math.min(c.floorY + 10, top - 4), z: mid });
      this.boss = {
        id: 0, boss: true, pos, vel: { x: 0, y: 0, z: 0 }, hp: B.hp, maxHp: B.hp, radius: B.radius,
        speed: B.speed + 0.15 * n, phase: 0, awake: false, hitFlash: 0,
        shotTimer: this.rng.range(...B.volleyEvery),
      };
      this.enemies.push(this.boss);
    }
    const regular = this.boss ? 0 : 3 + n;
    for (let i = 0; i < regular; i++) {
      const s = c.randomAirSpot(c.chamberZ0 + 20, c.chamberZ1 - 5, 1);
      if (!s) continue;
      this.enemies.push({
        id: i, pos: this.toWorld(s), vel: { x: 0, y: 0, z: 0 }, hp: E.hp, radius: E.radius,
        speed: E.baseSpeed + E.speedPerLevel * (n - 1) + this.rng.range(-0.3, 0.3),
        orbit: this.rng.range(E.orbitMin, E.orbitMax),
        phase: this.rng.range(0, Math.PI * 2),
        shooter: n >= E.shootFromLevel && this.rng() < 0.3 + 0.1 * n,
        shotTimer: this.rng.range(...E.shotEvery),
        hitFlash: 0, awake: false,
      });
    }
    this.pickups = [];
    for (let i = 0; i < 2; i++) {
      const s = c.floorSpot(c.chamberZ0 + 8, c.chamberZ1 - 2);
      if (s) this.pickups.push({ pos: this.toWorld(s), taken: false });
    }
    this.doorOpen = false;
    this.emit('levelStart', { level: n, boss: !!this.boss });
  }

  // další jeskyně se staví po kouscích na pozadí (volá se každý snímek)
  startPending() {
    this.next = new Cave(this.level + 1, this.seed,
      { oz: this.cur.oz + this.cur.nz, entrance: true, deferred: true });
  }

  // stavba po kouscích v časovém limitu (ms) na snímek; vždy aspoň jeden krok
  buildStep(budgetMs = 3) {
    const nx = this.next;
    if (!nx || nx.added) return;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    do { if (nx.step(1)) { this.attachNext(); return; } } while (now() - t0 < budgetMs);
  }

  finishPending() {
    const nx = this.next;
    if (!nx || nx.added) return;
    nx.finish();
    this.attachNext();
  }

  attachNext() {
    this.next.added = true;
    this.cave.add(this.next);
    this.emit('caveReady', { cave: this.next });
  }

  // vstup: { moveX, moveY, turn, thrust (0..1), fire (bool), aimDir?:{x,y,z} }
  update(input, dt) {
    dt = Math.min(dt, 0.05);
    if (this.state !== 'playing') return;
    this.updatePlayer(input, dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePickups();
    if (!this.doorOpen && this.enemies.every((e) => e.hp <= 0)) {
      this.doorOpen = true;
      this.cur.openDoor();
      this.cur.doorOpened = true;
      this.finishPending();            // za dveřmi musí další jeskyně už být
      this.emit('doorOpen', { cave: this.cur });
    }
    const nx = this.next, p = this.player;
    // proletěl tunelem do další jeskyně → nová úroveň, bez zastavení
    if (nx && nx.added && p.pos.z > nx.oz + nx.chamberZ0 + 1) this.enterNext();
    // opuštěnou jeskyni zahoď, až je hráč hluboko v nové (za zády, v mlze)
    if (this.prev && p.pos.z > this.cur.oz + this.cur.chamberZ0 + 16) this.dropPrev();
  }

  enterNext() {
    this.score += CFG.score.levelBonus + Math.round(this.player.fuel * CFG.score.fuelBonusPerUnit);
    this.emit('levelDone', { level: this.level });
    if (this.prev) this.dropPrev();
    this.prev = this.cur;
    this.cur = this.next;
    this.next = null;
    this.level += 1;
    this.populateLevel();
    this.startPending();
  }

  dropPrev() {
    const old = this.prev;
    this.cave.remove(old);
    this.prev = null;
    // zazdi vstup do nové jeskyně (za ním už nic není)
    const c = this.cur, t = c.tunnel;
    for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) c.set(x, y, 0, ROCK);
    this.emit('caveRemoved', { cave: old, sealed: c });
  }

  // okamžitý přesun do další úrovně (testy, ladění)
  nextLevel() {
    this.finishPending();
    this.player.pos = this.toWorld(this.next.spawn, this.next);
    this.player.vel = { x: 0, y: 0, z: 0 };
    this.enterNext();
    this.dropPrev();
  }

  updatePlayer(input, dt) {
    const p = this.player;
    p.yaw -= (input.turn || 0) * P.turnSpeed * dt;
    const f = forwardOf(p.yaw), r = rightOf(p.yaw);
    const mx = input.moveX || 0, my = input.moveY || 0;
    const want = { x: (f.x * my + r.x * mx) * P.walkSpeed, z: (f.z * my + r.z * mx) * P.walkSpeed };
    const acc = p.onGround ? P.groundAccel : P.airAccel;
    const k = 1 - Math.exp(-acc * dt);
    p.vel.x += (want.x - p.vel.x) * k;
    p.vel.z += (want.z - p.vel.z) * k;
    p.vel.y -= P.gravity * dt;
    const thrust = Math.max(0, Math.min(1, input.thrust || 0));
    p.thrusting = thrust > 0 && p.fuel > 0 ? thrust : 0;
    if (p.thrusting) {
      p.vel.y += P.thrust * p.thrusting * dt;
      p.fuel = Math.max(0, p.fuel - P.fuelBurn * p.thrusting * dt);
    }
    p.vel.y = Math.max(-P.maxFall, Math.min(P.maxRise, p.vel.y));
    const res = moveBox(this.cave, p.pos, p.vel, { w: P.w, h: P.h }, dt);
    p.onGround = res.onGround;
    p.onLava = p.onGround && this.touchingLava();
    if (p.onLava) {
      // láva: vymrštění vzhůru a (mimo ochrannou dobu) ztráta života
      p.vel.y = CFG.lava.bounce;
      p.onGround = false;
      this.emit('lava', { pos: { ...p.pos } });
      this.hurtPlayer(true);
    }
    if (p.onGround && !p.thrusting) p.fuel = Math.min(P.fuelMax, p.fuel + P.fuelRegen * dt);
    if (p.invuln > 0) p.invuln -= dt;

    // míření: směr z ovladače/kamery, jinak dopředu
    p.aim = norm(input.aimDir || { x: f.x, y: 0, z: f.z });
    p.cooldown -= dt;
    if (input.fire && p.cooldown <= 0) {
      p.cooldown = CFG.gun.cooldown;
      this.fire();
    }
  }

  // stojí hráč (kteroukoli částí chodidel) na lávě?
  touchingLava() {
    const p = this.player, hw = P.w / 2 - 0.02, y = p.pos.y - 0.05;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw])
      if (this.cave.lavaAt(p.pos.x + dx, y, p.pos.z + dz)) return true;
    return false;
  }

  gunMuzzle() {
    const p = this.player, r = rightOf(p.yaw), f = forwardOf(p.yaw);
    return { x: p.pos.x + r.x * 0.35 + f.x * 0.6, y: p.pos.y + 1.25, z: p.pos.z + r.z * 0.35 + f.z * 0.6 };
  }

  fire() {
    const from = this.gunMuzzle();
    let dir = this.player.aim;
    // jemná pomoc s mířením: nejbližší nepřítel v úzkém kuželu
    // kužel se rozšíří o úhlovou velikost cíle (velký boss „chytá" i okrajové střely)
    const assist = (CFG.gun.assistDeg * Math.PI) / 180;
    let best = null, bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const v = sub(e.pos, from), dist = len(v), d = norm(v);
      const ang = Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.y * dir.y + d.z * dir.z)));
      const size = Math.atan((e.radius || CFG.enemy.radius) / Math.max(dist, 0.1));
      const score = ang - size;
      if (score < assist && score < bestScore) { bestScore = score; best = d; }
    }
    if (best) dir = best;
    const v = CFG.gun.speed;
    this.bullets.push({ pos: { ...from }, vel: { x: dir.x * v, y: dir.y * v, z: dir.z * v }, life: CFG.gun.life });
    this.emit('shoot', { from });
  }

  updateBullets(dt) {
    for (const b of this.bullets) {
      const nx = b.pos.x + b.vel.x * dt, ny = b.pos.y + b.vel.y * dt, nz = b.pos.z + b.vel.z * dt;
      const hit = this.cave.raycast(b.pos.x, b.pos.y, b.pos.z, nx, ny, nz, 0.2);
      if (hit) { b.life = 0; this.emit('spark', { pos: hit }); continue; }
      b.pos.x = nx; b.pos.y = ny; b.pos.z = nz;
      b.life -= dt;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (len(sub(e.pos, b.pos)) < (e.radius || CFG.enemy.radius) + 0.15) {
          b.life = 0;
          e.hp -= 1; e.hitFlash = 0.15; e.awake = true;
          if (e.boss) this.bossHit(e, b);
          else if (e.hp <= 0) {
            this.score += e.minion ? CFG.score.minion : CFG.score.kill;
            this.emit('kill', { pos: { ...e.pos }, minion: !!e.minion });
          } else this.emit('hit', { pos: { ...e.pos } });
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    const p = this.player;
    const center = { x: p.pos.x, y: p.pos.y + 1.0, z: p.pos.z };
    for (const s of this.shots) {
      s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;
      s.life -= dt;
      if (this.cave.solidAt(s.pos.x, s.pos.y, s.pos.z)) s.life = 0;
      else if (len(sub(s.pos, center)) < 0.8) { s.life = 0; this.hurtPlayer(); }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  // zásah bosse: −1 % zdraví a vypustí jednu malou příšerku (do limitu)
  bossHit(e, b) {
    if (e.hp <= 0) {
      this.score += CFG.score.boss;
      this.emit('bossKill', { pos: { ...e.pos } });
      // s bossem padnou i jeho příšerky
      for (const m of this.enemies) if (m.minion && m.hp > 0) {
        m.hp = 0;
        this.emit('kill', { pos: { ...m.pos }, minion: true, chain: true });
      }
      return;
    }
    this.emit('bossHit', { pos: { ...b.pos }, pct: e.hp / e.maxHp });
    this.spawnMinion(e, b.pos);
  }

  spawnMinion(boss, at) {
    const M = CFG.minion;
    if (this.enemies.filter((m) => m.minion && m.hp > 0).length >= CFG.boss.maxMinions) return;
    // vyletí z místa zásahu směrem ven od středu bosse
    const out = norm(sub(at, boss.pos));
    const minion = {
      minion: true, pos: { x: at.x + out.x * 0.6, y: at.y + out.y * 0.6, z: at.z + out.z * 0.6 },
      vel: { x: out.x * 7, y: out.y * 7 + 2, z: out.z * 7 }, hp: M.hp, radius: M.radius,
      speed: M.speed + 0.2 * this.level, orbit: this.rng.range(...M.orbit),
      phase: this.rng.range(0, Math.PI * 2), shooter: false, hitFlash: 0, awake: true,
    };
    // znovupoužij místo po mrtvé příšerce (stejný index = stejný model ve scéně)
    let i = this.enemies.findIndex((m) => m.minion && m.hp <= 0);
    if (i < 0) { i = this.enemies.length; this.enemies.push(minion); } else this.enemies[i] = minion;
    minion.id = i;
    this.emit('minionSpawn', { index: i });
  }

  updateBoss(e, dt, center, t) {
    const B = CFG.boss;
    const toP = sub(center, e.pos), dist = len(toP);
    if (!e.awake && dist < CFG.enemy.wakeDist + 10) { e.awake = true; this.emit('bossAwake'); }
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (!e.awake) return;
    // drží si odstup před hráčem, vznáší se vysoko a pomalu krouží
    const dir = norm({ x: toP.x, y: 0, z: toP.z });
    const ang = t * 0.25;
    const target = { x: center.x - dir.x * B.keepDist + Math.cos(ang) * 4,
                     y: Math.max(this.cave.floorY + 4, center.y + B.hoverUp + Math.sin(t * 0.7) * 2),
                     z: center.z - dir.z * B.keepDist + Math.sin(ang) * 4 };
    const d = sub(target, e.pos), dl = len(d);
    const want = dl > 0.1 ? { x: d.x / dl * e.speed, y: d.y / dl * e.speed, z: d.z / dl * e.speed } : { x: 0, y: 0, z: 0 };
    const k = 1 - Math.exp(-1.5 * dt);
    e.vel.x += (want.x - e.vel.x) * k; e.vel.y += (want.y - e.vel.y) * k; e.vel.z += (want.z - e.vel.z) * k;
    const size = B.radius * 1.6;
    const feet = { x: e.pos.x, y: e.pos.y - size / 2, z: e.pos.z };
    moveBox(this.cave, feet, e.vel, { w: size, h: size }, dt);
    e.pos = { x: feet.x, y: feet.y + size / 2, z: feet.z };
    if (dist < B.contactDist) this.hurtPlayer();
    // dávka koulí do vějíře, jen s výhledem na hráče
    e.shotTimer -= dt;
    if (e.shotTimer <= 0 && dist < 40 &&
        !this.cave.raycast(e.pos.x, e.pos.y, e.pos.z, center.x, center.y, center.z, 0.4)) {
      e.shotTimer = this.rng.range(...B.volleyEvery);
      const n = this.rng.int(...B.volleySize);
      const aim = norm(toP), side = norm({ x: -aim.z, y: 0, z: aim.x });
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.12;
        const v = norm({ x: aim.x + side.x * spread, y: aim.y + this.rng.range(-0.05, 0.05), z: aim.z + side.z * spread });
        this.shots.push({ pos: { ...e.pos }, vel: { x: v.x * B.shotSpeed, y: v.y * B.shotSpeed, z: v.z * B.shotSpeed }, life: 6, big: true });
      }
      this.emit('bossVolley', { pos: { ...e.pos }, n });
    }
  }

  updateEnemies(dt) {
    const p = this.player, E = CFG.enemy;
    const center = { x: p.pos.x, y: p.pos.y + 1.0, z: p.pos.z };
    const t = performanceNow();
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.boss) { this.updateBoss(e, dt, center, t); continue; }
      if (e.hitFlash > 0) e.hitFlash -= dt;
      const toP = sub(center, e.pos);
      const dist = len(toP);
      if (!e.awake && dist < E.wakeDist) e.awake = true;
      let target;
      if (!e.awake) {
        target = { x: e.pos.x, y: e.pos.y + Math.sin(t * 1.5 + e.phase) * 0.3, z: e.pos.z };
      } else {
        // kroužení kolem hráče ve vzdálenosti `orbit`, občas výpad
        const ang = t * 0.5 + e.phase;
        const lunge = Math.sin(t * 0.35 + e.phase * 2) > 0.75;
        const rad = lunge ? 0.5 : e.orbit;
        // v obrovské síni létají i vysoko nad hráčem a pod ním — plný 3D prostor
        const floor = this.cave.floorY + 1.2;
        target = { x: center.x + Math.cos(ang) * rad,
                   y: Math.max(floor, center.y + 2 + Math.sin(t * 0.6 + e.phase) * 5),
                   z: center.z + Math.sin(ang) * rad };
      }
      const d = sub(target, e.pos);
      const dl = len(d);
      const want = dl > 0.01 ? { x: d.x / dl * e.speed, y: d.y / dl * e.speed, z: d.z / dl * e.speed } : { x: 0, y: 0, z: 0 };
      const k = 1 - Math.exp(-2.5 * dt);
      e.vel.x += (want.x - e.vel.x) * k; e.vel.y += (want.y - e.vel.y) * k; e.vel.z += (want.z - e.vel.z) * k;
      const hs = e.minion ? 0.25 : 0.5;
      const feet = { x: e.pos.x, y: e.pos.y - hs, z: e.pos.z };
      moveBox(this.cave, feet, e.vel, { w: hs * 1.8, h: hs * 2 }, dt);
      e.pos = { x: feet.x, y: feet.y + hs, z: feet.z };

      if (dist < (e.minion ? 0.8 : E.contactDist)) this.hurtPlayer();
      if (e.shooter && e.awake) {
        e.shotTimer -= dt;
        // střílí jen s výhledem na hráče — za sloupem je hráč v bezpečí
        if (e.shotTimer <= 0 && dist < 22 &&
            !this.cave.raycast(e.pos.x, e.pos.y, e.pos.z, center.x, center.y, center.z, 0.3)) {
          e.shotTimer = this.rng.range(...E.shotEvery);
          const dir = norm(toP);
          this.shots.push({ pos: { ...e.pos }, vel: { x: dir.x * E.shotSpeed, y: dir.y * E.shotSpeed, z: dir.z * E.shotSpeed }, life: 4 });
          this.emit('enemyShot', { pos: { ...e.pos } });
        }
      }
    }
  }

  updatePickups() {
    const p = this.player;
    for (const k of this.pickups) {
      if (k.taken) continue;
      const d = Math.hypot(k.pos.x - p.pos.x, k.pos.y + 0.4 - (p.pos.y + 0.9), k.pos.z - p.pos.z);
      if (d < CFG.pickup.radius + 0.5) {
        k.taken = true;
        p.fuel = Math.min(P.fuelMax, p.fuel + CFG.pickup.fuel);
        this.emit('pickup');
      }
    }
  }

  hurtPlayer(fromLava = false) {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'playing') return;
    p.lives -= 1;
    p.invuln = P.invulnTime;
    this.emit('playerHit', { lives: p.lives });
    if (p.lives <= 0) {
      this.state = 'gameover';
      this.emit('gameOver', { score: this.score });
    } else if (!fromLava) {
      // odhoď hráče kousek zpět a nahoru
      const f = forwardOf(p.yaw);
      p.vel.x = -f.x * 6; p.vel.z = -f.z * 6; p.vel.y = 4;
    }
  }

  get enemiesLeft() { return this.enemies.filter((e) => e.hp > 0).length; }
  get bossPct() { return this.boss && this.boss.hp > 0 ? Math.round(100 * this.boss.hp / this.boss.maxHp) : 0; }
}

// čas pro animace nepřátel; v testech jde nastavit ručně
let _clock = null;
export function setClock(fn) { _clock = fn; }
function performanceNow() {
  if (_clock) return _clock();
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}
