// Pohyb kvádru (hráč, nepřítel) mřížkou jeskyně s kolizemi po osách.
// pos = střed podstavy (nohy), size = {w, h}. Čistá logika, bez three.js.

const EPS = 1e-3;

function overlaps(cave, x, y, z, w, h) {
  const hw = w / 2;
  const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
  const y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS);
  const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
  for (let yy = y0; yy <= y1; yy++)
    for (let zz = z0; zz <= z1; zz++)
      for (let xx = x0; xx <= x1; xx++)
        if (cave.get(xx, yy, zz) !== 0) return true;
  return false;
}

// Posune pos o vel*dt; při nárazu vynuluje příslušnou složku rychlosti.
export function moveBox(cave, pos, vel, size, dt) {
  const res = { onGround: false, hitWall: false, hitCeiling: false };
  // velký krok rozděl, ať se neprolétá stěnou
  const maxStep = 0.25;
  const dist = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(dist / maxStep));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const axis of ['x', 'z', 'y']) {
      const d = vel[axis] * h;
      if (d === 0) continue;
      const next = { x: pos.x, y: pos.y, z: pos.z };
      next[axis] += d;
      if (overlaps(cave, next.x, next.y, next.z, size.w, size.h)) {
        if (axis === 'y') {
          if (d < 0) { res.onGround = true; pos.y = Math.floor(pos.y + EPS); }
          else res.hitCeiling = true;
        } else res.hitWall = true;
        vel[axis] = 0;
      } else {
        pos[axis] = next[axis];
      }
    }
  }
  // stojí na zemi i bez pohybu dolů?
  if (!res.onGround && vel.y <= 0 && overlaps(cave, pos.x, pos.y - 0.05, pos.z, size.w, size.h))
    res.onGround = true;
  return res;
}

export { overlaps };
