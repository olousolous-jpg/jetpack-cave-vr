# Jetpack Cave VR

> Stav vývoje, rozhodnutí a jak navázat: [STAV.md](STAV.md)

Kostičková jeskyně, jetpack na zádech a fialové příšery. WebXR hra pro **Meta
Quest 3**, která běží přímo v prohlížeči. Nic se neinstaluje.

**Hrát:** na Questu otevři v prohlížeči adresu
`https://olousolous-jpg.github.io/jetpack-cave-vr/` a klepni na **VSTOUPIT DO VR**.
Na počítači jde hrát klávesnicí a myší (**HRÁT NA POČÍTAČI**).

## Hra
- Pohled z třetí osoby: kamera je za postavou přes pravé rameno a plynule ji sleduje.
- Jetpack bere palivo. Na zemi se pomalu doplňuje, zelené kanystry přidají +60.
- Jeskyně je obrovská síň: až ~100 m široká, ~38 m vysoká a 140 m dlouhá.
  Příšery létají v celém prostoru, nad hráčem i pod ním.
- Krápníků je málo a s úrovní ubývají: v 1. úrovni 5 (hlavně sloupy od podlahy
  ke stropu), od 6. úrovně žádné, takže se není za čím schovat. Příšery střílí
  jen s výhledem na hráče. Počet jde změnit v `src/config.js` (`cave.pillars`).
- Na podlaze jsou lávová jezírka, s každou úrovní jich přibývá a rostou. Šlápnutí
  do lávy vezme život a vymrští tě vzhůru, na lávě se nedoplňuje palivo. Start,
  cesta k východu a kanystry jsou vždy mimo lávu, láva nikdy nezabere víc než
  30 % podlahy.
- V každé jeskyni je pár příšer. Když padnou všechny, otevře se modrá bariéra
  na konci. Tunel vede rovnou do další, těžší jeskyně (víc příšer, rychlejší,
  od 2. úrovně střílí). Přechod je plynulý, bez načítání a ztmavení: další
  jeskyně se staví na pozadí po malých kouscích (max ~2 ms na snímek), už
  během hraní předchozí úrovně.
- Každá druhá úroveň (2., 4., 6. …) je s **bossem**: obří příšera s korunou a
  ukazatelem zdraví. Každý zásah mu ubere 1 % zdraví a vypustí jednu malou
  rychlou příšerku (naráz nejvýš 20 kvůli výkonu). Boss střílí dávky koulí,
  když na tebe vidí. Když padne, vybuchnou i všechny jeho příšerky a otevře se
  průchod dál.
- 3 životy, skóre a nejlepší skóre (uloží se v prohlížeči).

## Ovládání
| Quest 3 | Akce |
|---|---|
| levá páčka | plynulý pohyb |
| pravá páčka | plynulé otáčení |
| levá spoušť / grip | jetpack (síla podle stisku) |
| pravá spoušť | střelba, míří se pravým ovladačem (laser) |
| A | start / nová hra po konci |
| B | zapnout / vypnout ztmavení okrajů při pohybu |
| Y | rychlost otáčení (pomalé / střední / rychlé) |

| Počítač | Akce |
|---|---|
| W A S D | pohyb |
| myš (po kliknutí do hry), ← → | otáčení |
| myš nahoru/dolů, ↑ ↓ | míření |
| mezerník | jetpack |
| levé tlačítko, F | střelba |
| Enter | nová hra po konci |

**Pohodlí ve VR:** plynulé otáčení a let můžou některým lidem dělat nevolno.
Hra proto při pohybu ztmaví okraje obrazu (vypíná se tlačítkem B) a otáčení
jde zpomalit tlačítkem Y. Kamera se nenaklání a neotáčí sama od sebe.

## Jak je to postavené
- Čisté HTML + JavaScript moduly, bez sestavování. Knihovna [three.js](https://threejs.org)
  (MIT) je přibalená ve `vendor/`.
- `src/world.js`, `cave.js`, `physics.js`: herní logika bez vykreslování (testuje se v Node).
- `src/chain.js`: řetěz jeskyní za sebou (fyzika a míření se ptají řetězu ve světových souřadnicích).
- `src/cavemesh.js`: model jeskyně jen z viditelných stěn kostek, v kusech po 10 m (mimo zorné pole se nekreslí), stavěný po kouscích.
- `src/game.js`: scéna, kamera, WebXR ovladače, HUD, efekty. `src/models.js`: kostičkové modely.
- `src/input.js`: mapování ovladačů Questu a klávesnice. `src/audio.js`: syntetizované zvuky.
- Nastavení ladění (rychlosti, palivo, kamera) je v `src/config.js`.

## Vývoj
```bash
python3 -m http.server 8000          # pak http://localhost:8000
npm test                             # testy logiky (Node 18+)
node test/browser-smoke.mjs          # hra v prohlížeči (Playwright + Chromium)
node test/vr-smoke.mjs               # VR v emulátoru Quest 3 (IWER, Meta, MIT)
```
WebXR vyžaduje HTTPS. Na Questu proto testuj přes GitHub Pages, ne přes IP adresu počítače.
