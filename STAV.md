# Stav projektu a navazování (pro další session)

Stav k 24. 9. 2026. Tenhle soubor shrnuje všechno potřebné k navázání po
vymazání kontextu: kdo, co, proč, jak testovat a co je rozdělané.

## Uživatel a pravidla spolupráce
- Komunikace **česky**. Než se začne větší věc psát, uživatel chce vidět **návrh**.
- **Soukromí je priorita:** žádná jména, e-maily ani adresy v gitu. Commity v tomhle
  (veřejném) repu jsou pod `olousolous-jpg <226580883+olousolous-jpg@users.noreply.github.com>`
  (nastavené v `.git/config`), ne pod skutečným e-mailem.
- **Projekty oddělené:** hra je jen v repu `olousolous-jpg/jetpack-cave-vr`, nic
  z ní nepatří do repa `hans`.
- Uživatel má **Meta Quest 3** a testuje na něm sám. Na počítači hru vyzkoušel:
  „na první pokus funguje“. Na Questu **zatím zpětnou vazbu nedal**, čeká se na ni.

## Druhý projekt v téhle session: Hans (jen odkaz)
Repo `olousolous-jpg/hans`: domácí AI majordomus na Raspberry Pi 5 + Hailo.
V téhle session vznikl instalátor ve složce `installer/` (PR #1–#4 sloučené).
Všechno o něm je v `installer/STAV.md` v repu hans. Pravidla tam: **kód Hanse
neměnit** (stará se o něj jiná session), soukromí, uživatel má jen jedno Pi,
na kterém Hans běží, proto `--dry-run` a `installer/test_install.sh`.

## Hra: Jetpack Cave VR
- Repo: https://github.com/olousolous-jpg/jetpack-cave-vr (veřejné, větev `main`)
- Hraje se: https://olousolous-jpg.github.io/jetpack-cave-vr/ (GitHub Pages z `main`,
  kořen). **Push do `main` = nasazení** (za 1–2 min, na Questu případně obnovit stránku).
- Session má repo připojené (`add_repo`, přístup push). Lokálně `/home/user/jetpack-cave-vr`.
  Nový repozitář integrace založit neumí (403), musí ho založit uživatel.
- Předloha vzhledu: obrázek od uživatele (retro pixel art: postava s jetpackem na
  zádech a pistolí, hnědo-zlatá kostičková jeskyně, modrá hloubka, fialové
  rozzlobené příšery, dole panel SCORE / FUEL / HIGH).

### Co hra umí (všechno hotové a nasazené)
| Oblast | Stav |
|---|---|
| Pohled | 3. osoba, kamera za postavou přes pravé rameno, plynule sleduje; ve VR se hýbe celý „vozík“ (rig), nenaklání se |
| Ovládání Quest | levá páčka pohyb, pravá **plynulé** otáčení (uživatel nechtěl skoky), levá spoušť/grip jetpack, pravá spoušť střelba (míří se pravým ovladačem, laser), A start, B ztmavení okrajů, Y rychlost otáčení |
| Ovládání PC | WASD, myš/šipky otáčení a míření, mezerník jetpack, klik/F střelba, Enter nová hra |
| Pohodlí VR | ztmavení okrajů (vinětace) při pohybu a otáčení, vypínatelné |
| Jetpack | palivo 150, spotřeba 22/s, na zemi se doplňuje 7/s, kanystry +60, nová úroveň = plná nádrž |
| Jeskyně | **obrovská síň** 110 × 46 × 150 m (klenba na rovné podlaze, až ~100 m šířka, ~38 m výška), generovaná, deterministická podle semínka |
| Krápníky | 1. úroveň 5, každou úroveň o 1 míň, od 6. žádné (přání uživatele: „ať není za čím se schovat“) |
| Láva | jezírka na podlaze, s úrovní víc a větší; dotek = −1 život + vymrštění; nikdy u startu, u východu, pod kanystrem, pod nízkým stropem (<6 m); max 30 % podlahy |
| Příšery | krouží v 3D, výpady, od 2. úrovně některé střílí, **jen s výhledem** |
| Boss | **každá sudá úroveň** (místo běžných příšer): 100 % zdraví, zásah = −1 % a vypustí malou příšerku (max 20 naráz), dávky 3–5 koulí, po smrti vybuchnou i příšerky |
| Přechod úrovní | **plynulý, bez načítání**: jeskyně jsou řetěz za sebou, výstupní tunel pokračuje do další; další jeskyně se staví na pozadí po krocích ~2 ms; stará se zahodí a vstup zazdí |
| HUD | retro panel (životy, skóre, palivo, úroveň/příšery/BOSS %, nejlepší skóre v localStorage), nápisy; ve VR panel dole před hráčem |
| Zvuky | syntetizované WebAudio, vibrace ovladačů |

### Architektura (čisté ES moduly, bez sestavování; three.js 0.186 ve `vendor/`)
- `src/config.js`: **všechna laditelná čísla** (rychlosti, palivo, kamera, boss, láva, `cave.pillars(level)`).
- `src/cave.js`: jedna jeskyně (mřížka 1 m, místní souřadnice, posun `oz`), generátor `build()` po krocích.
- `src/chain.js`: řetěz jeskyní, dotazy ve světových souřadnicích (fyzika, míření, kamera).
- `src/world.js`: herní logika bez grafiky (hráč, příšery, boss, střely, láva, úrovně, stavba další jeskyně). Události `events[]`.
- `src/physics.js`: pohyb kvádru mřížkou s kolizemi.
- `src/cavemesh.js`: model jeskyně jen z viditelných stěn, kusy po 10 m (frustum culling), generátor po řádcích.
- `src/game.js`: three.js scéna, kamera, WebXR, HUD, efekty, reakce na události, stavba modelů po kouscích.
- `src/models.js`: kostičkové modely (postava, příšera / boss / příšerka, kanystr).
- `src/input.js` (Quest `mapXRSources` + klávesnice), `src/hud.js`, `src/audio.js`, `src/main.js`, `index.html`.

### Testování (před každým pushem)
```bash
cd /home/user/jetpack-cave-vr
npm test                          # 20 testů logiky (node --test)
node test/browser-smoke.mjs       # Chromium (Playwright globálně): hra, průlet do 2. úrovně, boss, snímky test/shots/
node test/vr-smoke.mjs            # VR v emulátoru Quest 3 (IWER, test/vendor/iwer.min.js)
```
Chromium běží softwarově (swiftshader), takže snímků je málo a herní čas běží
pomaleji. Testy proto čekají na stav hry, ne na pevný čas. Výkon měří
`browser-smoke`: trojúhelníky na snímek (~85 tisíc), nejdelší krok stavby
na pozadí (typicky 2–4 ms, limit testu 15 ms).

### Čeká se na uživatele (zpětná vazba z Questu)
- Plynulost ve velké jeskyni a při stavbě další jeskyně (prvních ~10–20 s úrovně).
- Rychlosti (pohyb, let, otáčení), vzdálenost kamery, pohodlí a vinětace.
- Délka boje s bossem (100 zásahů) a výkon s 20 příšerkami.

### Nápady a otázky do budoucna
- Uživatel zvažuje **Godot** (nativní APK, víc výkonu). Doporučeno zůstat u WebXR,
  dokud se ladí mechaniky, pak přepsat. 3D modely: kódem (kostičky/voxely/low-poly),
  skripty pro Blender → `.glb`, nebo hotové CC0 modely (Kenney, Quaternius) či
  AI generátory (Meshy, Tripo), jejichž výstup uživatel pošle.
- Nabídnuté, zatím nezadané: hudba, nové druhy příšer a zbraní.
