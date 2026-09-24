// Kostičkové modely (postava s jetpackem, fialová příšera, kanystr, střely).
// Všechno z kvádrů — retro vzhled podle návrhu a málo polygonů pro Quest.
import * as THREE from 'three';

const box = (w, h, d, color, opts = {}) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, ...opts }));
  return m;
};
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

// Postava stojí nohama v počátku a dívá se do +z.
export function makeHero() {
  const g = new THREE.Group();
  const skin = 0xf2b48a, hair = 0x6b3b1e, shirt = 0xeeeeee, pants = 0xc0262b;

  g.add(at(box(0.26, 0.8, 0.3, pants), -0.15, 0.45, 0));
  g.add(at(box(0.26, 0.8, 0.3, pants), 0.15, 0.45, 0));
  g.add(at(box(0.28, 0.12, 0.38, 0x3b2616), -0.15, 0.06, 0.04));
  g.add(at(box(0.28, 0.12, 0.38, 0x3b2616), 0.15, 0.06, 0.04));
  g.add(at(box(0.62, 0.1, 0.34, 0x222222), 0, 0.88, 0));           // opasek
  g.add(at(box(0.62, 0.62, 0.34, shirt), 0, 1.24, 0));             // trup
  const head = new THREE.Group();
  head.position.set(0, 1.72, 0.02);
  head.add(box(0.38, 0.38, 0.38, skin));
  head.add(at(box(0.4, 0.14, 0.42, hair), 0, 0.17, -0.01));
  head.add(at(box(0.4, 0.3, 0.1, hair), 0, 0.04, -0.17));
  head.add(at(box(0.07, 0.06, 0.02, 0x222222), -0.09, 0.03, 0.19)); // oči
  head.add(at(box(0.07, 0.06, 0.02, 0x222222), 0.09, 0.03, 0.19));
  g.add(head);

  // paže s pistolí — celá skupina se natáčí podle míření (pitch)
  const arms = new THREE.Group();
  arms.position.set(0, 1.42, 0.05);
  const armR = at(box(0.16, 0.16, 0.55, shirt), -0.22, 0, 0.26);
  const armL = at(box(0.16, 0.16, 0.5, shirt), 0.14, -0.04, 0.26);
  arms.add(armR, armL);
  arms.add(at(box(0.14, 0.14, 0.14, skin), -0.18, -0.02, 0.56));
  const gun = new THREE.Group();
  gun.position.set(-0.18, 0.05, 0.62);
  gun.add(box(0.12, 0.14, 0.42, 0x3a3a3a));
  gun.add(at(box(0.1, 0.18, 0.1, 0x2a2a2a), 0, -0.13, -0.1));
  gun.add(at(box(0.13, 0.1, 0.1, 0xd9822b, { emissive: 0x552200 }), 0, 0.01, 0.24));
  arms.add(gun);
  g.add(arms);

  // jetpack na zádech
  const pack = new THREE.Group();
  pack.position.set(0, 1.2, -0.3);
  pack.add(box(0.5, 0.62, 0.24, 0x777c84));
  for (const x of [-0.2, 0.2]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10),
      new THREE.MeshLambertMaterial({ color: 0xc9ced6 }));
    tank.position.set(x, 0, -0.15);
    pack.add(tank);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.12, 10),
      new THREE.MeshLambertMaterial({ color: 0x444444 }));
    nozzle.position.set(x, -0.41, -0.15);
    pack.add(nozzle);
  }
  const core = at(box(0.2, 0.2, 0.04, 0x33ccff, { emissive: 0x1188ff, emissiveIntensity: 1.2 }), 0, 0.08, -0.13);
  pack.add(core);
  // plameny trysek
  const flames = [];
  for (const x of [-0.2, 0.2]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.9 }));
    f.rotation.x = Math.PI;
    f.position.set(x, -0.72, -0.15);
    f.visible = false;
    pack.add(f);
    flames.push(f);
  }
  const light = new THREE.PointLight(0xff9a3c, 0, 7, 1.6);
  light.position.set(0, -0.6, -0.2);
  pack.add(light);
  g.add(pack);

  g.userData = { arms, flames, light, core, head };
  return g;
}

export function animateHero(model, player, time) {
  const { arms, flames, light } = model.userData;
  model.position.set(player.pos.x, player.pos.y, player.pos.z);
  model.rotation.y = player.yaw;
  // pitch paží podle míření
  const a = player.aim;
  const pitch = Math.atan2(a.y, Math.hypot(a.x, a.z));
  arms.rotation.x = -Math.max(-1.2, Math.min(1.2, pitch));
  const on = player.thrusting > 0;
  for (const f of flames) {
    f.visible = on;
    const s = 0.7 + 0.5 * player.thrusting + 0.25 * Math.sin(time * 40 + f.position.x * 10);
    f.scale.set(1, s, 1);
  }
  light.intensity = on ? 2.5 * player.thrusting : 0;
  // blikání při nesmrtelnosti po zásahu
  model.visible = !(player.invuln > 0 && Math.floor(time * 12) % 2 === 0);
}

export function makeEnemy() {
  const g = new THREE.Group();
  const purple = 0x7b4fd6, dark = 0x3d2178;
  const body = box(0.9, 0.85, 0.7, purple);
  g.add(body);
  g.add(at(box(0.62, 0.22, 0.56, purple), 0, 0.5, 0));
  const eyeW = 0xffffff;
  for (const x of [-0.2, 0.2]) {
    g.add(at(box(0.22, 0.2, 0.05, eyeW), x, 0.12, 0.36));
    g.add(at(box(0.09, 0.1, 0.03, 0x111111), x * 0.85, 0.1, 0.39));
    const brow = at(box(0.26, 0.07, 0.05, dark), x, 0.27, 0.37);
    brow.rotation.z = x < 0 ? -0.45 : 0.45;
    g.add(brow);
  }
  g.add(at(box(0.36, 0.12, 0.04, 0x2a0f45), 0, -0.16, 0.36));      // pusa
  g.add(at(box(0.3, 0.04, 0.02, 0xffffff), 0, -0.12, 0.385));       // zuby
  for (const x of [-1, 1]) {
    const arm = at(box(0.2, 0.5, 0.22, purple), x * 0.58, -0.05, 0);
    arm.rotation.z = x * 0.5;
    g.add(arm);
    g.add(at(box(0.22, 0.25, 0.26, purple), x * 0.22, -0.52, 0));   // nohy
  }
  g.userData.body = body;
  g.traverse((o) => { if (o.material) o.material = o.material.clone(); });
  return g;
}

export function animateEnemy(model, e, player, time) {
  model.visible = e.hp > 0;
  if (!model.visible) return;
  model.position.set(e.pos.x, e.pos.y + Math.sin(time * 3 + e.phase) * 0.08, e.pos.z);
  model.rotation.y = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  const flash = e.hitFlash > 0 ? 1 : 0;
  model.traverse((o) => {
    if (o.material && o.material.emissive) o.material.emissive.setRGB(flash, flash, flash);
  });
  const s = e.shooter ? 1.05 : 1;
  model.scale.setScalar(s);
}

export function makeCanister() {
  const g = new THREE.Group();
  g.add(at(box(0.4, 0.55, 0.28, 0x2fbf4a, { emissive: 0x0b5a1a }), 0, 0.3, 0));
  g.add(at(box(0.42, 0.08, 0.3, 0xffffff), 0, 0.36, 0));
  g.add(at(box(0.12, 0.1, 0.12, 0x222222), 0.1, 0.62, 0));
  const l = new THREE.PointLight(0x44ff66, 1.2, 4, 2);
  l.position.y = 0.5;
  g.add(l);
  return g;
}

export const bulletGeo = new THREE.BoxGeometry(0.08, 0.08, 0.45);
export const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
export const shotGeo = new THREE.IcosahedronGeometry(0.2, 0);
export const shotMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
