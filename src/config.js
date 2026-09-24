// Laditelné konstanty hry na jednom místě.
export const CFG = {
  player: {
    w: 0.7, h: 1.8,
    walkSpeed: 5.5,          // m/s vodorovně
    groundAccel: 12, airAccel: 5,
    turnSpeed: 2.2,          // rad/s při plném vychýlení páčky (plynulé otáčení)
    gravity: 14,
    thrust: 27,              // zrychlení vzhůru při plném tahu
    maxRise: 7, maxFall: 14,
    fuelMax: 150,
    fuelBurn: 22,            // za sekundu při plném tahu
    fuelRegen: 7,            // za sekundu na zemi
    lives: 3,
    invulnTime: 2.0,
  },
  gun: { speed: 32, life: 1.4, cooldown: 0.16, assistDeg: 7 },
  enemy: {
    radius: 0.6, hp: 3, baseSpeed: 2.0, speedPerLevel: 0.3,
    contactDist: 1.1, orbitMin: 6, orbitMax: 14, wakeDist: 32,
    shootFromLevel: 2, shotSpeed: 7, shotEvery: [2.5, 4.5],
  },
  // boss v každé sudé úrovni: zásah = −1 % zdraví a jedna malá příšerka
  boss: {
    everyNth: 2, hp: 100, radius: 2.3, scale: 3.4, speed: 2.4, keepDist: 16, hoverUp: 7,
    contactDist: 3.0, volleyEvery: [2.2, 3.4], volleySize: [3, 5], shotSpeed: 8,
    maxMinions: 20,            // víc příšerek naráz by Quest nezvládl plynule
  },
  minion: { hp: 1, radius: 0.35, scale: 0.5, speed: 4.2, orbit: [2.5, 6] },
  pickup: { fuel: 60, radius: 1.0 },
  lava: { bounce: 9 },              // vymrštění z lávy (m/s vzhůru)
  // rozměry jeskyně (m) a krápníky podle úrovně: 1. úroveň 5, pak ubývají, od 6. žádné
  cave: { nx: 110, ny: 46, nz: 150, pillars: (level) => Math.max(0, 6 - level) },
  score: { kill: 100, minion: 20, boss: 1500, levelBonus: 250, fuelBonusPerUnit: 1 },
  camera: { back: 4.2, up: 2.1, side: 0.75, followRate: 6, yawRate: 7, headHeight: 1.6 },
};
