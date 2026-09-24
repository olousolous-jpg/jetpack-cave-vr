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
  const perf = await page.evaluate(async () => {
    const g = window.__game, w = g.world;
    const { buildCaveSteps } = await import('./src/cavemesh.js');
    const { Cave } = await import('./src/cave.js');
    // nejdelší jednotlivý krok stavby další jeskyně (data i model) = největší možný zásek
    const c = new Cave(7, 99, { oz: 0, entrance: true, deferred: true });
    let maxGen = 0, t;
    for (;;) { t = performance.now(); const done = c.step(1); maxGen = Math.max(maxGen, performance.now() - t); if (done) break; }
    const it = buildCaveSteps(c); let maxMesh = 0, r;
    do { t = performance.now(); r = it.next(); maxMesh = Math.max(maxMesh, performance.now() - t); } while (!r.done);
    g.renderer.render(g.scene, g.camera);
    return { maxGenStepMs: +maxGen.toFixed(1), maxMeshStepMs: +maxMesh.toFixed(1),
             triangles: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls }; });
  console.log('výkon:', JSON.stringify(perf));
  if (perf.triangles > 120000) errors.push('moc trojúhelníků na snímek: ' + perf.triangles);
  if (perf.maxGenStepMs > 8 || perf.maxMeshStepMs > 8) errors.push('krok stavby na pozadí je moc dlouhý: ' + JSON.stringify(perf));
  // plynulý přechod: zabij příšery, postav hráče do tunelu a nech ho doběhnout do další jeskyně
  await page.evaluate(() => { const w = window.__game.world; w.enemies.forEach((e) => (e.hp = 0)); });
  await page.waitForFunction(() => window.__game.world.doorOpen, null, { timeout: 20000 });
  await page.evaluate(() => { const g = window.__game, w = g.world, c = w.cur;
    w.player.pos = { x: c.tunnel.x0 + 2, y: c.floorY, z: c.oz + c.doorZ - 3 }; w.player.yaw = 0; w.player.invuln = 99;
    g.snapCamera(); g.banner.hide(); });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test/shots/4-tunnel.png' });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__game.world.level === 2, null, { timeout: 90000 });
  await page.keyboard.up('KeyW');
  console.log('přechod do 2. úrovně bez Enteru za', Date.now() - t0, 'ms reálného času');
  await page.waitForTimeout(500);
  const st2 = await page.evaluate(() => { const g = window.__game;
    return { state: g.world.state, level: g.world.level, caves: g.world.cave.caves.length, visuals: g.caveVisuals.size }; });
  console.log('po průletu:', JSON.stringify(st2));
  await page.screenshot({ path: 'test/shots/5-level2.png' });
  // 5. úroveň: víc lávy — snímek z výšky nad jezírkem
  await page.evaluate(() => { const g = window.__game, w = g.world; for (let i = 0; i < 3; i++) w.nextLevel(); });
  await page.waitForFunction(() => window.__game.meshJobs.length === 0 && window.__game.world.level === 5, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__game, w = g.world, c = w.cur; const pool = c.pools[0]; w.player.invuln = 0.01;
    if (pool) w.player.pos = { x: pool.x, y: c.floorY + 5, z: pool.z + c.oz - 7 }; g.snapCamera(); g.banner.hide(); });
  await page.keyboard.down('Space'); await page.waitForTimeout(1500); await page.keyboard.up('Space');
  await page.screenshot({ path: 'test/shots/6-level5-lava.png' });
  const vis = await page.evaluate(() => ({ caves: window.__game.world.cave.caves.length, visuals: window.__game.caveVisuals.size }));
  if (vis.visuals > 3) errors.push('staré jeskyně se nezahazují: ' + JSON.stringify(vis));
  if (st2.level !== 2 || st2.state !== 'playing') errors.push('přechod do 2. úrovně selhal: ' + JSON.stringify(st2));
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) { console.error('CHYBY:\n' + errors.join('\n')); process.exit(1); }
console.log('OK — bez chyb v konzoli');
