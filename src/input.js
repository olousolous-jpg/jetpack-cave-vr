// Ovládání: ovladače Questu (WebXR) i klávesnice + myš na počítači.
//
// Quest 3:  levá páčka = pohyb, pravá páčka = plynulé otáčení,
//           levá spoušť (nebo levý grip) = jetpack, pravá spoušť = střelba,
//           A = start / další úroveň, B = zapnout/vypnout ztmavení okrajů,
//           Y = rychlost otáčení
// Počítač:  WASD = pohyb, myš (po kliknutí) nebo ←/→ = otáčení, ↑/↓ = míření,
//           mezerník = jetpack, levé tlačítko / F = střelba, Enter = start

export const DEADZONE = 0.15;

const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const btn = (gp, i) => (gp && gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);

// Čistá funkce: seznam XRInputSource → herní vstup. Testuje se bez headsetu.
export function mapXRSources(sources) {
  const out = { moveX: 0, moveY: 0, turn: 0, thrust: 0, fire: false, start: false,
                toggleVignette: false, cycleTurn: false };
  for (const s of sources || []) {
    const gp = s.gamepad;
    if (!gp) continue;
    const ax = gp.axes || [];
    // xr-standard: páčka je na osách 2/3 (0/1 bývají touchpad, u Questu 0)
    const sx = dz(ax[2] ?? ax[0] ?? 0), sy = dz(ax[3] ?? ax[1] ?? 0);
    if (s.handedness === 'left') {
      out.moveX = sx; out.moveY = -sy || 0;
      out.thrust = Math.max(btn(gp, 0), btn(gp, 1));
      out.cycleTurn = btn(gp, 5) > 0.5;        // Y
    } else if (s.handedness === 'right') {
      out.turn = sx;
      out.fire = btn(gp, 0) > 0.5;
      out.start = btn(gp, 4) > 0.5 || out.fire; // A (nebo spoušť)
      out.toggleVignette = btn(gp, 5) > 0.5;   // B
    }
  }
  return out;
}

export class Keyboard {
  constructor(dom) {
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.mouseDown = false;
    this.latched = new Set();     // krátký stisk se nesmí ztratit mezi snímky
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.latched.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.clicked = true; }
      if (document.pointerLockElement !== dom) dom.requestPointerLock?.();
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
  }

  read(dt) {
    const k = (c) => this.keys.has(c) || this.latched.has(c);
    const moveX = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const moveY = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    // myš: pixely → „vychýlení páčky" (turnSpeed rad/s)
    const mouseTurn = dt > 0 ? this.mouseDX * 0.0025 / dt / 2.2 : 0;
    const turn = (k('ArrowRight') || k('KeyE') ? 1 : 0) - (k('ArrowLeft') || k('KeyQ') ? 1 : 0) + mouseTurn;
    const pitch = ((k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0)) * 1.2 * dt - this.mouseDY * 0.0025;
    this.mouseDX = 0; this.mouseDY = 0;
    const fireClick = this.clicked; this.clicked = false;
    const out = {
      moveX, moveY, turn, pitch,
      thrust: k('Space') ? 1 : 0,
      fire: this.mouseDown || fireClick || k('KeyF'),
      start: k('Enter'),
    };
    this.latched.clear();
    return out;
  }
}
