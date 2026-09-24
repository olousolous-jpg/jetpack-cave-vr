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
    contactDist: 1.1, orbitMin: 5, orbitMax: 10, wakeDist: 22,
    shootFromLevel: 2, shotSpeed: 7, shotEvery: [2.5, 4.5],
  },
  pickup: { fuel: 60, radius: 1.0 },
  lava: { bounce: 9 },              // vymrštění z lávy (m/s vzhůru)
  score: { kill: 100, levelBonus: 250, fuelBonusPerUnit: 1 },
  camera: { back: 4.2, up: 2.1, side: 0.75, followRate: 6, yawRate: 7, headHeight: 1.6 },
};
