// Vykreslení a propojení: three.js scéna, kamera z třetí osoby, WebXR, HUD, zvuky.
import * as THREE from 'three';
import { World, forwardOf, rightOf } from './world.js';
import { AIR, DOOR, LAVA } from './cave.js';
import { CFG } from './config.js';
import { makeHero, animateHero, makeEnemy, animateEnemy, makeCanister,
         bulletGeo, bulletMat, shotGeo, shotMat } from './models.js';
import { Hud, Banner } from './hud.js';
import { buildCaveGeometry } from './cavemesh.js';
import { Keyboard, mapXRSources } from './input.js';
import { Sfx } from './audio.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem('jcvr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jcvr.' + k, JSON.stringify(v)); } catch { /* soukromé okno */ } },
};
const TURN_SPEEDS = [0.6, 1.0, 1.5];
// pixelová láva: tmavě červená → oranžová → žlutá
const LAVA_COLORS = [0xb81800, 0xe03000, 0xff5500, 0xff7a00, 0xffa200, 0xffd040];

export class Game {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    // 'local' = počátek v místě hlavy při vstupu do VR, výška hráče nehraje roli
    this.renderer.xr.setReferenceSpaceType('local');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1440);
    this.scene.fog = new THREE.Fog(0x0a1440, 35, 150);
    this.scene.add(new THREE.HemisphereLight(0xa8c4ff, 0x6a4a2a, 1.7));
    const sun = new THREE.DirectionalLight(0xffe2b0, 0.6);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);

    // rig = „vozík" s kamerou; ve VR s ním jezdí hlava hráče
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 220);
    this.rig.add(this.camera);
    // „lucerna“ u kamery: prosvítí nejbližší stěny, dál zůstává modrá hloubka
    this.lantern = new THREE.PointLight(0xfff0d8, 2.4, 26, 1.1);
    this.scene.add(this.lantern);

    this.world = new World();
    this.high = store.get('high', 0);
    this.settings = { vignette: store.get('vignette', true), turnIdx: store.get('turnIdx', 1) };
    this.sfx = new Sfx();
    this.keyboard = new Keyboard(this.renderer.domElement);
    this.pitch = 0;
    this.camPos = new THREE.Vector3();
    this.camYaw = 0;
    this.prevButtons = {};
    this.clock = new THREE.Clock();
    this.time = 0;

    this.hero = makeHero();
    this.scene.add(this.hero);
    this.caveGroup = new THREE.Group();
    this.scene.add(this.caveGroup);
    this.enemyModels = [];
    this.pickupModels = [];
    this.bulletPool = this.pool(40, () => new THREE.Mesh(bulletGeo, bulletMat));
    this.shotPool = this.pool(30, () => new THREE.Mesh(shotGeo, shotMat));
    this.particles = [];
    this.partPool = this.pool(120, () => new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })));

    this.setupHud();
    this.setupXR();
    this.buildLevel();
    this.showMenu();
    this.snapCamera();

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  pool(n, make) {
    const items = [];
    for (let i = 0; i < n; i++) { const m = make(); m.visible = false; this.scene.add(m); items.push(m); }
    return items;
  }

  get inVR() { return this.renderer.xr.isPresenting; }

  // ── HUD ────────────────────────────────────────────────────────────────
  setupHud() {
    this.hud = new Hud();
    this.banner = new Banner();
    // VR: panel dole před hráčem (přichycený k vozíku, ne k hlavě)
    const mat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
    this.hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9 * 300 / 1024), mat(this.hud.texture));
    this.hudMesh.position.set(0, -0.5, -1.0);
    this.hudMesh.rotation.x = -0.55;
    this.hudMesh.renderOrder = 998;
    this.bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), mat(this.banner.texture));
    this.bannerMesh.position.set(0, 0.45, -2.2);
    this.bannerMesh.renderOrder = 998;
    this.rig.add(this.hudMesh, this.bannerMesh);
    this.hudMesh.visible = this.bannerMesh.visible = false;
    // počítač: stejné plátno jako překryv stránky
    this.hud.canvas.id = 'hud';
    this.banner.canvas.id = 'banner';
    document.body.append(this.hud.canvas, this.banner.canvas);
  }

  // ── WebXR: ovladače, laser, ztmavení okrajů ──────────────────────────────
  setupXR() {
    this.controllers = [0, 1].map((i) => {
      const c = this.renderer.xr.getController(i);
      c.userData.handedness = null;
      c.addEventListener('connected', (e) => { c.userData.handedness = e.data.handedness; });
      c.addEventListener('disconnected', () => { c.userData.handedness = null; });
      this.rig.add(c);
      const grip = this.renderer.xr.getControllerGrip(i);
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12),
        new THREE.MeshLambertMaterial({ color: 0x333a44 }));
      grip.add(stick);
      this.rig.add(grip);
      return c;
    });
    const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.6 }));
    this.laser.visible = false;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, depthTest: false }));
    this.reticle.renderOrder = 997;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // tunelové vidění při pohybu (proti nevolnosti)
    this.vignette = new THREE.Mesh(new THREE.RingGeometry(0.24, 2, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
    this.vignette.position.z = -0.3;
    this.vignette.renderOrder = 999;
    this.camera.add(this.vignette);
    this.vignetteLevel = 0;

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.sfx.unlock();
      document.body.classList.add('vr');
      this.hudMesh.visible = true;
      this.bannerMesh.visible = true;
      this.snapCamera();
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      document.body.classList.remove('vr');
      this.hudMesh.visible = this.bannerMesh.visible = false;
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.snapCamera();
    });
  }

  rightController() {
    return this.controllers.find((c) => c.userData.handedness === 'right') || null;
  }

  // ── jeskyně ──────────────────────────────────────────────────────────────
  buildLevel() {
    for (const c of [...this.caveGroup.children]) {
      c.geometry?.dispose?.();
      this.caveGroup.remove(c);
    }
    const cave = this.world.cave;
    const cells = cave.surfaceCells();
    const rock = cells.filter((c) => c[3] !== DOOR && c[3] !== LAVA), door = cells.filter((c) => c[3] === DOOR);
    const lava = cells.filter((c) => c[3] === LAVA);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    // skála: jeden model jen z viditelných stěn (viz cavemesh.js)
    const rockMesh = new THREE.Mesh(buildCaveGeometry(cave), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.caveGroup.add(rockMesh);
    // energetická bariéra ve dveřích
    this.doorMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      color: 0x55ddff, transparent: true, opacity: 0.55 }), Math.max(1, door.length));
    door.forEach(([x, y, z], i) => { m.makeTranslation(x + 0.5, y + 0.5, z + 0.5); this.doorMesh.setMatrixAt(i, m); });
    this.doorMesh.count = door.length;
    this.caveGroup.add(this.doorMesh);
    // láva: zapuštěná o kousek níž než podlaha, svítí a pulzuje (barva se mění v sync())
    this.lavaMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.lavaMesh = new THREE.InstancedMesh(geo, this.lavaMat, Math.max(1, lava.length));
    lava.forEach(([x, y, z], i) => {
      m.makeTranslation(x + 0.5, y + 0.35, z + 0.5);
      this.lavaMesh.setMatrixAt(i, m);
      this.lavaMesh.setColorAt(i, col.setHex(LAVA_COLORS[(x * 7 + z * 13) % LAVA_COLORS.length]));
    });
    this.lavaMesh.count = lava.length;
    this.caveGroup.add(this.lavaMesh);
    this.lavaCells = lava;
    // oranžová záře nad největšími jezírky (max 4 světla — výkon na Questu)
    [...cave.pools].sort((a, b) => b.cells - a.cells).slice(0, 4).forEach((pool) => {
      const l = new THREE.PointLight(0xff6a20, 2 + pool.r * 0.4, 6 + pool.r * 2.5, 1.5);
      l.position.set(pool.x, cave.floorY + 1.2, pool.z);
      this.caveGroup.add(l);
    });
    this.bubbleAt = 0;
    // modré krystaly na stěnách (osvětlení hloubky)
    const crystals = rock.filter((c, i) => (i * 2654435761 >>> 0) % 97 === 0 && cave.get(c[0], c[1] + 1, c[2]) === AIR).slice(0, 40);
    const cry = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.6, 0),
      new THREE.MeshBasicMaterial({ color: 0x4fb4ff }), Math.max(1, crystals.length));
    crystals.forEach(([x, y, z], i) => {
      m.makeTranslation(x + 0.5, y + 1.0, z + 0.5);
      cry.setMatrixAt(i, m);
    });
    cry.count = crystals.length;
    this.caveGroup.add(cry);
    // světlo u východu
    const exitLight = new THREE.PointLight(0x55ddff, 3, 14, 1.5);
    exitLight.position.set(cave.nx / 2, cave.floorY + 2, cave.doorZ - 1);
    this.caveGroup.add(exitLight);

    // nepřátelé a kanystry
    for (const mdl of this.enemyModels) this.scene.remove(mdl);
    this.enemyModels = this.world.enemies.map(() => { const e = makeEnemy(); this.scene.add(e); return e; });
    for (const mdl of this.pickupModels) this.scene.remove(mdl);
    this.pickupModels = this.world.pickups.map((k) => {
      const c = makeCanister(); c.position.set(k.pos.x, k.pos.y, k.pos.z); this.scene.add(c); return c;
    });
  }

  // ── obrazovky ─────────────────────────────────────────────────────────────
  showMenu() {
    this.banner.show(['JETPACK CAVE', this.inVR ? 'Stiskni A nebo pravou spoušť' : 'Enter nebo klikni na HRÁT'], 0, this.time);
  }

  startGame() {
    this.sfx.unlock();
    this.world.newGame();
    this.buildLevel();
    this.snapCamera();
    this.banner.show(['ÚROVEŇ 1', 'Znič všechny příšery'], 2.5, this.time);
    document.body.classList.add('playing');
  }

  // ── snímek ───────────────────────────────────────────────────────────────
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const w = this.world;
    const input = this.readInput(dt);

    const pressed = (name, v) => { const was = this.prevButtons[name]; this.prevButtons[name] = v; return v && !was; };
    const startPressed = pressed('start', input.start);
    if (pressed('vig', input.toggleVignette)) {
      this.settings.vignette = !this.settings.vignette; store.set('vignette', this.settings.vignette);
      this.banner.show(['ZTMAVENÍ OKRAJŮ', this.settings.vignette ? 'zapnuto' : 'vypnuto'], 1.5, this.time);
    }
    if (pressed('turn', input.cycleTurn)) {
      this.settings.turnIdx = (this.settings.turnIdx + 1) % TURN_SPEEDS.length; store.set('turnIdx', this.settings.turnIdx);
      this.banner.show(['OTÁČENÍ', ['pomalé', 'střední', 'rychlé'][this.settings.turnIdx]], 1.5, this.time);
    }

    if (w.state === 'menu' && startPressed) this.startGame();
    else if (w.state === 'cleared' && startPressed && this.time > this.clearedAt + 1.2) {
      w.nextLevel(); this.buildLevel(); this.snapCamera();
      this.banner.show(['ÚROVEŇ ' + w.level, (w.enemies.length) + ' příšer'], 2.5, this.time);
    } else if (w.state === 'gameover' && startPressed && this.time > this.overAt + 1.5) this.startGame();

    input.turn *= TURN_SPEEDS[this.settings.turnIdx];
    w.update(input, dt);
    this.handleEvents();
    this.sfx.jetpack(w.state === 'playing' ? w.player.thrusting : 0);

    this.updateCamera(dt, input);
    this.sync(dt);
    this.hud.draw(w, Math.max(this.high, w.score));
    this.bannerMesh.visible = this.inVR && this.banner.visible(this.time);
    this.banner.canvas.style.display = !this.inVR && this.banner.visible(this.time) ? 'block' : 'none';
    this.renderer.render(this.scene, this.camera);
  }

  readInput(dt) {
    let input;
    if (this.inVR) {
      const session = this.renderer.xr.getSession();
      input = mapXRSources(session ? session.inputSources : []);
      input.aimDir = this.vrAim();
    } else {
      input = this.keyboard.read(dt);
      this.pitch = Math.max(-0.9, Math.min(0.9, this.pitch - (input.pitch || 0)));
      input.aimDir = this.desktopAim();
      input.toggleVignette = false; input.cycleTurn = false;
    }
    return input;
  }

  // míření na počítači: paprsek středem obrazovky (zaměřovač)
  desktopAim() {
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    return this.aimFromRay(origin, dir, false);
  }

  // míření ve VR: paprsek z pravého ovladače
  vrAim() {
    const c = this.rightController();
    if (!c) { this.laser.visible = false; this.reticle.visible = false; return null; }
    if (this.laser.parent !== c) c.add(this.laser);
    const origin = c.getWorldPosition(new THREE.Vector3());
    const q = c.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return this.aimFromRay(origin, dir, true);
  }

  aimFromRay(origin, dir, showLaser) {
    const cave = this.world.cave, maxD = 45;
    const end = origin.clone().addScaledVector(dir, maxD);
    const hit = cave.raycast(origin.x, origin.y, origin.z, end.x, end.y, end.z, 0.25);
    let dist = hit ? hit.dist : maxD;
    // nepřítel blízko paprsku má přednost
    for (const e of this.world.enemies) {
      if (e.hp <= 0) continue;
      const v = new THREE.Vector3(e.pos.x - origin.x, e.pos.y - origin.y, e.pos.z - origin.z);
      const t = v.dot(dir);
      if (t > 0 && t < dist && v.addScaledVector(dir, -t).length() < 0.8) dist = t;
    }
    const target = origin.clone().addScaledVector(dir, dist);
    if (showLaser) {
      this.laser.visible = true;
      this.laser.scale.z = dist;
      this.reticle.visible = true;
      this.reticle.position.copy(target);
      this.reticle.lookAt(origin);
    }
    const m = this.world.gunMuzzle();
    const d = new THREE.Vector3(target.x - m.x, target.y - m.y, target.z - m.z).normalize();
    return { x: d.x, y: d.y, z: d.z };
  }

  // kamera za postavou; ve VR se hýbe celý vozík (plynule, bez naklánění)
  desiredCamera() {
    const p = this.world.player, C = CFG.camera;
    const f = forwardOf(p.yaw), r = rightOf(p.yaw);
    const head = new THREE.Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z);
    // za postavou a kousek vpravo („přes rameno“), ať zaměřovač nemíří do zad
    const want = new THREE.Vector3(p.pos.x - f.x * C.back + r.x * C.side, p.pos.y + C.up + 0.4,
                                   p.pos.z - f.z * C.back + r.z * C.side);
    // neprojet stěnou: přitáhni kameru k postavě
    const hit = this.world.cave.raycast(head.x, head.y, head.z, want.x, want.y, want.z, 0.1);
    if (hit) want.lerpVectors(head, want, Math.max(0.15, hit.t - 0.12));
    return want;
  }

  snapCamera() {
    this.camPos.copy(this.desiredCamera());
    this.camYaw = this.world.player.yaw;
    this.updateCamera(0, {});
  }

  updateCamera(dt, input) {
    const C = CFG.camera, p = this.world.player;
    const want = this.desiredCamera();
    const k = dt > 0 ? 1 - Math.exp(-C.followRate * dt) : 1;
    this.camPos.lerp(want, k);
    this.lantern.position.set(this.camPos.x, this.camPos.y + 0.5, this.camPos.z);
    const ky = dt > 0 ? 1 - Math.exp(-C.yawRate * dt) : 1;
    let dy = p.yaw - this.camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.camYaw += dy * ky;

    if (this.inVR) {
      this.rig.position.copy(this.camPos);
      this.rig.rotation.set(0, this.camYaw + Math.PI, 0);
      // ztmavení okrajů podle rychlosti otáčení a pohybu
      const speed = Math.hypot(p.vel.x, p.vel.z) / CFG.player.walkSpeed;
      const want = this.settings.vignette && this.world.state === 'playing'
        ? Math.min(0.8, Math.abs(input.turn || 0) * 0.9 + Math.max(0, speed - 0.3) * 0.45 + Math.abs(p.vel.y) * 0.03) : 0;
      this.vignetteLevel += (want - this.vignetteLevel) * (dt > 0 ? 1 - Math.exp(-8 * dt) : 1);
      this.vignette.material.opacity = this.vignetteLevel;
      this.vignette.visible = this.vignetteLevel > 0.01;
    } else {
      this.vignette.visible = false;
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.camera.position.copy(this.camPos);
      const f = forwardOf(this.camYaw), r = rightOf(this.camYaw), s = CFG.camera.side;
      const L = 20;   // zaměřovač míří vodorovně daleko před postavu
      const look = new THREE.Vector3(p.pos.x + f.x * L * Math.cos(this.pitch) + r.x * s, p.pos.y + 1.9 + L * Math.sin(this.pitch),
                                     p.pos.z + f.z * L * Math.cos(this.pitch) + r.z * s);
      this.camera.lookAt(look);
    }
  }

  // ── stav → modely ────────────────────────────────────────────────────────
  sync(dt) {
    const w = this.world, t = this.time;
    animateHero(this.hero, w.player, t);
    w.enemies.forEach((e, i) => this.enemyModels[i] && animateEnemy(this.enemyModels[i], e, w.player, t));
    w.pickups.forEach((k, i) => {
      const m = this.pickupModels[i];
      if (!m) return;
      m.visible = !k.taken;
      m.rotation.y = t * 1.5;
      m.position.y = k.pos.y + 0.1 + Math.sin(t * 2 + i) * 0.08;
    });
    const place = (pool, items, orient) => {
      pool.forEach((m, i) => {
        const b = items[i];
        m.visible = !!b;
        if (!b) return;
        m.position.set(b.pos.x, b.pos.y, b.pos.z);
        if (orient) m.lookAt(b.pos.x + b.vel.x, b.pos.y + b.vel.y, b.pos.z + b.vel.z);
      });
    };
    place(this.bulletPool, w.bullets, true);
    place(this.shotPool, w.shots, false);
    this.doorMesh.visible = !w.doorOpen;
    // láva pulzuje a občas z ní vyletí žhavá bublina
    const glow = 0.85 + 0.15 * Math.sin(t * 3);
    this.lavaMat.color.setRGB(glow, glow, glow);
    const lc = this.lavaCells.length;
    if (lc && this.lavaMesh.instanceColor) {
      // „vření": pár náhodných kostek změní odstín každý snímek
      const tmp = new THREE.Color();
      for (let i = 0; i < Math.max(1, lc >> 4); i++) {
        const k = Math.floor(Math.random() * lc);
        this.lavaMesh.setColorAt(k, tmp.setHex(LAVA_COLORS[Math.floor(Math.random() * LAVA_COLORS.length)]));
      }
      this.lavaMesh.instanceColor.needsUpdate = true;
    }
    if (this.lavaCells.length && t > this.bubbleAt) {
      this.bubbleAt = t + 0.25;
      const [x, y, z] = this.lavaCells[Math.floor(Math.random() * this.lavaCells.length)];
      this.burst({ x: x + 0.5, y: y + 1, z: z + 0.5 }, 0xffa030, 2, 1.5);
    }
    // částice
    this.particles = this.particles.filter((pt) => {
      pt.life -= dt;
      pt.vel.y -= 6 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.rotation.x += dt * 5;
      if (pt.life <= 0) { pt.mesh.visible = false; return false; }
      return true;
    });
  }

  burst(pos, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const mesh = this.partPool.find((m) => !m.visible);
      if (!mesh) return;
      mesh.visible = true;
      mesh.material.color.setHex(color);
      mesh.position.set(pos.x, pos.y, pos.z);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.particles.push({ mesh, vel: v, life: 0.5 + Math.random() * 0.5 });
    }
  }

  handleEvents() {
    const w = this.world;
    for (const ev of w.events) {
      this.sfx.play(ev.type);
      switch (ev.type) {
        case 'kill': this.burst(ev.pos, 0x8a5cf0, 22, 6); this.pulse(0.6, 80); break;
        case 'hit': this.burst(ev.pos, 0xffffff, 5, 3); this.pulse(0.3, 30); break;
        case 'spark': this.burst(ev.pos, 0xffd060, 3, 2); break;
        case 'playerHit': this.pulse(1, 250, true);
          this.banner.show(['AU!', 'Zbývá životů: ' + ev.lives], 1.2, this.time); break;
        case 'lava': this.pulse(1, 200, true); this.burst(ev.pos, 0xff7020, 12, 4); break;
        case 'pickup': this.banner.show(['PALIVO +' + CFG.pickup.fuel], 1.0, this.time); break;
        case 'doorOpen': this.banner.show(['PRŮCHOD OTEVŘEN!', 'Leť k modré záři na konci'], 2.5, this.time); break;
        case 'levelDone':
          this.clearedAt = this.time;
          this.saveHigh();
          this.banner.show(['ÚROVEŇ ' + ev.level + ' HOTOVA', 'Skóre ' + w.score + ' — pokračuj ' + (this.inVR ? 'tlačítkem A' : 'Enterem')], 0, this.time);
          break;
        case 'gameOver':
          this.overAt = this.time;
          this.saveHigh();
          this.banner.show(['KONEC HRY', 'Skóre ' + ev.score + ' — znovu ' + (this.inVR ? 'tlačítkem A' : 'Enterem')], 0, this.time);
          break;
      }
    }
    w.events.length = 0;
  }

  saveHigh() {
    if (this.world.score > this.high) { this.high = this.world.score; store.set('high', this.high); }
  }

  // vibrace ovladače
  pulse(strength, ms, both = false) {
    if (!this.inVR) return;
    const s = this.renderer.xr.getSession();
    for (const src of s?.inputSources || []) {
      if (!both && src.handedness !== 'right') continue;
      src.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
    }
  }
}
