// Herní logika bez vykreslování: hráč, nepřátelé, střely, palivo, úrovně.
// Scéna (scene.js) jen čte stav a kreslí; zvuky a efekty reagují na `events`.
import { Cave } from './cave.js';
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
    this.state = 'menu';            // menu | playing | cleared | gameover
    this.player = {
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, fuel: P.fuelMax, lives: P.lives, invuln: 0,
      onGround: false, thrusting: 0, cooldown: 0, aim: { x: 0, y: 0, z: 1 },
    };
    this.startLevel(1);
    this.state = 'menu';
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  newGame() {
    this.score = 0;
    this.player.lives = P.lives;
    this.startLevel(1);
  }

  startLevel(n) {
    this.level = n;
    this.cave = new Cave(n, this.seed);
    const p = this.player;
    Object.assign(p.pos, this.cave.spawn);
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = 0;                       // jeskyně vede ve směru +z
    p.fuel = P.fuelMax;
    p.invuln = 1.0;
    this.bullets = [];
    this.shots = [];                 // střely nepřátel
    this.enemies = [];
    const E = CFG.enemy;
    const count = 2 + n;
    for (let i = 0; i < count; i++) {
      const s = this.cave.randomAirSpot(this.cave.chamberZ0 + 14, this.cave.chamberZ1 - 3, 1);
      if (!s) continue;
      this.enemies.push({
        id: i, pos: s, vel: { x: 0, y: 0, z: 0 }, hp: E.hp,
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
      const s = this.cave.floorSpot(this.cave.chamberZ0 + 8, this.cave.chamberZ1 - 2);
      if (s) this.pickups.push({ pos: s, taken: false });
    }
    this.doorOpen = false;
    this.state = 'playing';
    this.emit('levelStart', { level: n });
  }

  // vstup: { moveX, moveY, turn, thrust (0..1), fire (bool), aimDir?:{x,y,z}, aimFrom? }
  update(input, dt) {
    dt = Math.min(dt, 0.05);
    if (this.state !== 'playing') return;
    this.updatePlayer(input, dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePickups();
    if (!this.doorOpen && this.enemies.every((e) => e.hp <= 0)) {
      this.doorOpen = true;
      this.cave.openDoor();
      this.emit('doorOpen');
    }
    if (this.doorOpen && this.player.pos.z > this.cave.exitZ) {
      this.score += CFG.score.levelBonus + Math.round(this.player.fuel * CFG.score.fuelBonusPerUnit);
      this.state = 'cleared';
      this.emit('levelDone', { level: this.level });
    }
  }

  nextLevel() { this.startLevel(this.level + 1); }

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
    const cosMax = Math.cos((CFG.gun.assistDeg * Math.PI) / 180);
    let best = null, bestCos = cosMax;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const d = norm(sub(e.pos, from));
      const c = d.x * dir.x + d.y * dir.y + d.z * dir.z;
      if (c > bestCos) { bestCos = c; best = d; }
    }
    if (best) dir = best;
    const v = CFG.gun.speed;
    this.bullets.push({ pos: { ...from }, vel: { x: dir.x * v, y: dir.y * v, z: dir.z * v }, life: CFG.gun.life });
    this.emit('shoot', { from });
  }

  updateBullets(dt) {
    const R = CFG.enemy.radius + 0.15;
    for (const b of this.bullets) {
      const nx = b.pos.x + b.vel.x * dt, ny = b.pos.y + b.vel.y * dt, nz = b.pos.z + b.vel.z * dt;
      const hit = this.cave.raycast(b.pos.x, b.pos.y, b.pos.z, nx, ny, nz, 0.2);
      if (hit) { b.life = 0; this.emit('spark', { pos: hit }); continue; }
      b.pos.x = nx; b.pos.y = ny; b.pos.z = nz;
      b.life -= dt;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (len(sub(e.pos, b.pos)) < R) {
          b.life = 0;
          e.hp -= 1; e.hitFlash = 0.15; e.awake = true;
          if (e.hp <= 0) {
            this.score += CFG.score.kill;
            this.emit('kill', { pos: { ...e.pos } });
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

  updateEnemies(dt) {
    const p = this.player, E = CFG.enemy;
    const center = { x: p.pos.x, y: p.pos.y + 1.0, z: p.pos.z };
    const t = performanceNow();
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
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
        target = { x: center.x + Math.cos(ang) * rad, y: center.y + 1.0 + Math.sin(t + e.phase) * 1.2,
                   z: center.z + Math.sin(ang) * rad };
      }
      const d = sub(target, e.pos);
      const dl = len(d);
      const want = dl > 0.01 ? { x: d.x / dl * e.speed, y: d.y / dl * e.speed, z: d.z / dl * e.speed } : { x: 0, y: 0, z: 0 };
      const k = 1 - Math.exp(-2.5 * dt);
      e.vel.x += (want.x - e.vel.x) * k; e.vel.y += (want.y - e.vel.y) * k; e.vel.z += (want.z - e.vel.z) * k;
      const feet = { x: e.pos.x, y: e.pos.y - 0.5, z: e.pos.z };
      moveBox(this.cave, feet, e.vel, { w: 0.9, h: 1.0 }, dt);
      e.pos = { x: feet.x, y: feet.y + 0.5, z: feet.z };

      if (dist < E.contactDist) this.hurtPlayer();
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
}

// čas pro animace nepřátel; v testech jde nastavit ručně
let _clock = null;
export function setClock(fn) { _clock = fn; }
function performanceNow() {
  if (_clock) return _clock();
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}
