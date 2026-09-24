// Kouřový test v prohlížeči: načte hru, klikne HRÁT, chvíli hraje klávesnicí,
// uloží snímky obrazovky a selže při chybě v konzoli.
// Spuštění: node test/browser-smoke.mjs   (potřebuje playwright + chromium)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }

const port = 8765;
const srv = spawn('python3', ['-m', 'http.server', String(port)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
mkdirSync('test/shots', { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
  await page.screenshot({ path: 'test/shots/1-intro.png' });
  await page.click('#play');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test/shots/2-start.png' });
  // let a kousek dopředu se střelbou
  await page.keyboard.down('KeyW'); await page.keyboard.down('Space'); await page.keyboard.down('KeyF');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyF');
  await page.screenshot({ path: 'test/shots/3-flight.png' });
  const st = await page.evaluate(() => {
    const w = window.__game.world;
    return { state: w.state, level: w.level, z: w.player.pos.z, y: w.player.pos.y, fuel: w.player.fuel,
             score: w.score, enemies: w.enemiesLeft, fps: window.__game.renderer.info.render.frame };
  });
  console.log('stav po letu:', JSON.stringify(st));
  // simulace dokončení úrovně: zabij příšery, přesuň hráče k východu
  await page.evaluate(() => { const w = window.__game.world; w.enemies.forEach((e) => (e.hp = 0)); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const w = window.__game.world; w.player.pos.z = w.cave.exitZ + 0.5; w.player.pos.x = w.cave.nx / 2; w.player.pos.y = w.cave.floorY; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shots/4-cleared.png' });
  await page.waitForFunction(() => { const g = window.__game; return g.world.state === 'cleared' && g.time > g.clearedAt + 1.4; }, null, { timeout: 30000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const st2 = await page.evaluate(() => ({ state: window.__game.world.state, level: window.__game.world.level }));
  console.log('po Enteru:', JSON.stringify(st2));
  await page.screenshot({ path: 'test/shots/5-level2.png' });
  // 5. úroveň: víc lávy a krápníků — snímek z výšky nad jezírkem
  await page.evaluate(() => { const g = window.__game, w = g.world; for (let i = 0; i < 3; i++) w.nextLevel();
    g.buildLevel(); const pool = w.cave.pools[0]; w.player.invuln = 0.01;
    if (pool) { w.player.pos = { x: pool.x, y: w.cave.floorY + 5, z: pool.z - 7 }; } g.snapCamera(); g.banner.hide(); });
  await page.keyboard.down('Space'); await page.waitForTimeout(1500); await page.keyboard.up('Space');
  await page.screenshot({ path: 'test/shots/6-level5-lava.png' });
  if (st2.level !== 2 || st2.state !== 'playing') errors.push('přechod do 2. úrovně selhal: ' + JSON.stringify(st2));
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) { console.error('CHYBY:\n' + errors.join('\n')); process.exit(1); }
console.log('OK — bez chyb v konzoli');
