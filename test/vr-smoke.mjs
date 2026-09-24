// Kouřový test režimu VR v emulátoru Meta Quest 3 (IWER): vstup do VR,
// start tlačítkem A, pohyb levou páčkou, jetpack levou spouští, otáčení
// pravou páčkou, střelba pravou spouští. Spuštění: node test/vr-smoke.mjs
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const root = new URL('..', import.meta.url).pathname;
const port = 8766;
const srv = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
mkdirSync(root + 'test/shots', { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript({ content: readFileSync(root + 'test/vendor/iwer.min.js', 'utf8') +
  ';window.__xr = new IWER.XRDevice(IWER.metaQuest3); window.__xr.installRuntime({ forceInstall: true });' });

const state = () => page.evaluate(() => {
  const g = window.__game, w = g.world;
  return { vr: g.inVR, state: w.state, z: +w.player.pos.z.toFixed(2), y: +w.player.pos.y.toFixed(2),
           yaw: +w.player.yaw.toFixed(2), fuel: Math.round(w.player.fuel), bullets: w.bullets.length,
           shotsFired: g.__shots || 0, rigZ: +g.rig.position.z.toFixed(2), vignette: +g.vignetteLevel.toFixed(2),
           laser: g.laser.visible };
});
const ctl = (hand, fn, ...a) => page.evaluate(([h, f, args]) => window.__xr.controllers[h][f](...args), [hand, fn, a]);
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.__game && document.getElementById('vr-button'), null, { timeout: 15000 });
  await wait(1500);
  const label = await page.textContent('#vr-button');
  console.log('tlačítko:', label);
  await page.click('#vr-button');
  await page.waitForFunction(() => window.__game.inVR, null, { timeout: 10000 });
  await page.evaluate(() => { const g = window.__game; g.world.events.length = 0;
    const orig = g.sfx.play.bind(g.sfx); g.sfx.play = (t) => { if (t === 'shoot') g.__shots = (g.__shots || 0) + 1; orig(t); }; });
  console.log('ve VR:', JSON.stringify(await state()));

  await ctl('right', 'updateButtonValue', 'a-button', 1); await wait(600);
  await ctl('right', 'updateButtonValue', 'a-button', 0); await wait(600);
  const s0 = await state(); console.log('po A:', JSON.stringify(s0));
  if (s0.state !== 'playing') errors.push('A nespustilo hru');

  await ctl('left', 'updateAxes', 'thumbstick', 0, -1);     // dopředu
  await ctl('left', 'updateButtonValue', 'trigger', 1);     // jetpack
  await ctl('right', 'updateButtonValue', 'trigger', 1);    // střelba
  await ctl('right', 'updateAxes', 'thumbstick', 0.8, 0);   // otáčení vpravo
  await wait(2500);
  const s1 = await state(); console.log('při letu:', JSON.stringify(s1));
  await page.screenshot({ path: root + 'test/shots/vr-1-flight.png' });
  await ctl('left', 'updateAxes', 'thumbstick', 0, 0);
  await ctl('left', 'updateButtonValue', 'trigger', 0);
  await ctl('right', 'updateButtonValue', 'trigger', 0);
  await ctl('right', 'updateAxes', 'thumbstick', 0, 0);
  await wait(800);
  const s2 = await state(); console.log('po puštění:', JSON.stringify(s2));
  await wait(2500);
  const s3 = await state(); console.log('o chvíli později:', JSON.stringify(s3));
  if (Math.abs(s3.yaw - s2.yaw) > 0.05) errors.push('po puštění pravé páčky se postava dál otáčí');
  if (s3.fuel < s2.fuel) errors.push('po puštění spouště jetpack dál bere palivo');
  if (s3.shotsFired > s2.shotsFired) errors.push('po puštění spouště se dál střílí');

  if (!(s1.z > s0.z + 0.5)) errors.push('levá páčka nepohnula postavou dopředu');
  if (!(s1.fuel < s0.fuel)) errors.push('levá spoušť nebrala palivo');
  if (!(s1.yaw < s0.yaw - 0.1)) errors.push('pravá páčka neotočila postavou');
  if (!(s1.shotsFired > 0)) errors.push('pravá spoušť nestřílela');
  if (!(s1.vignette > 0.05)) errors.push('ztmavení okrajů se při pohybu nezapnulo');
  if (!s1.laser) errors.push('laser pravého ovladače není vidět');
  if (Math.abs(s1.rigZ - s0.rigZ) < 0.3) errors.push('kamera (vozík) nesleduje postavu');
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) { console.error('CHYBY:\n' + errors.join('\n')); process.exit(1); }
console.log('OK — VR ovládání funguje v emulátoru Quest 3');
