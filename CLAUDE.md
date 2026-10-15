# CLAUDE.md — Bloqueador de anuncios para Chrome (Twitch y YouTube)

Extensión de Chrome (Manifest V3) que bloquea anuncios en cualquier web con las listas de AdGuard y
trata aparte YouTube y Twitch. Solo para el Chrome de Fran, cargada descomprimida en modo
desarrollador: ni Chrome Web Store ni Portainer. La infraestructura compartida está en el
`CLAUDE.md` de `PyCharm Projects`, que se carga solo: **no la dupliques aquí**.

Croquis de decisión: `ProjectKit/ideas/bloqueador-de-anuncios-para-chrome-twitch-y-youtube.md`.
**Léelo antes de proponer arquitectura**: la decisión de hacer este proyecto se tomó con ese
alcance (carcasa que consume piezas mantenidas por otros), no con otro.

## Coordenadas

| | |
|---|---|
| Repo | `getFran/AdBlock` (privado — **debe seguirlo**) |
| Rama | `main` |
| Despliegue | **ninguno**: `npm run build` deja `dist/`, que se carga con "Load unpacked" |

## Decisiones tomadas (2026-10-15)

- **Arquitectura de carcasa.** La extensión no reimplementa lógica de bloqueo. El build toma:
  rulesets DNR precompilados y el texto de filtro embebido de `@adguard/dnr-rulesets` (la versión
  del paquete **es** la foto de las listas: va fijada en `package.json`), los scriptlets de
  `@adguard/scriptlets`, las reglas de YouTube del filtro Base de AdGuard más la familia
  `json-prune` de `uAssets/filters/quick-fixes.txt` (snapshot en `vendor/`), y para Twitch el hook
  del Worker portado de Purple Ads Blocker (`github.com/arthurbolsoni/Purple-adblock`, **Apache-2.0**,
  no GPL-3: la procedencia está citada en cada fichero de `src/twitch/`).
- **Toolchain:** Node ≥ 22 (en la máquina hay 24) con esbuild. Fuente en `src/` en JavaScript
  plano; `build.mjs` genera `dist/` (ignorado en git). `npm run build` funciona desde un clon limpio
  con solo `npm install`: no descarga nada de la red.
- **Los scripts de MAIN world van declarados en el manifest con `run_at: document_start`**, nunca
  inyectados desde el service worker (ver memoria `mv3-main-world-document-start…`).
- **CSS cosmético por `document.adoptedStyleSheets`**, no con `<style>`: la CSP de la página no
  puede bloquear el CSSOM. `<style>` queda de fallback.
- **Los selectores por dominio van en cubos JSON (`dist/cosmetic/bucket-N.json`) que el runtime
  pide por `fetch`**, no como content scripts con match patterns: se probó y 53.000 patrones en el
  manifest dejaban Chromium sin arrancar durante minutos. Con JSON arranca en 2 s.
- **Sin Extended CSS todavía:** las reglas `#?#` y las pseudo-clases `:contains()`, `:upward()`,
  `:matches-css()`… se descartan en el build (unas 5.300). `:has()` sí entra porque es CSS nativo.
  Si hace falta, `@adguard/extended-css` es la pieza.

## Cómo funciona

```
build.mjs        lee build.config.mjs y escribe dist/:
  rulesets/      ruleset_<id>.json de AdGuard sin su regla de metadatos (el Base pesa 20 MB con ella)
  cosmetic/      runtime.js (selectores genéricos + runtime) y bucket-N.json (por dominio)
  youtube.js     MAIN world: 31 reglas compiladas (27 del Base de AdGuard, 4 de uAssets)
  twitch.js      MAIN world: hook de Worker/fetch de la página con src/twitch/worker.js inlined
  background.js  service worker de diagnóstico (rulesets habilitados, peticiones bloqueadas)
  manifest.json
```

- **Red:** 8 rulesets habilitados por defecto (Base, Tracking Protection, Spanish/Portuguese, URL
  Tracking, Cookie Notices, Popups, Other Annoyances, Widgets): 205.343 reglas y 185 regex. Chrome
  garantiza 30.000 estáticas por extensión más un fondo común de 300.000 y 1.000 regex; el build
  imprime los totales y aborta si pasa de las 1.000 regex. Si otra extensión con DNR compite por el
  fondo, el service worker lo dice al instalar (`missing`).
- **Cosmético:** 16.006 selectores genéricos inyectados en el acto a `document_start`; después
  el cubo del dominio (hash de las dos últimas etiquetas del host, `src/lib/hash.js`) con sus
  selectores, sus reglas `#$#` y sus excepciones `#@#`, que también se restan de la hoja genérica.
- **YouTube:** `json-prune` sobre `JSON.parse`/`Response.json`, `json-prune-fetch-response`,
  `json-prune-xhr-response`, `set-constant` para el `ytInitialPlayerResponse` inline, las
  contramedidas (`onAbnormalityDetected`, iframe `about:blank`, temporizador de 17 s)… todo
  compilado en build; `src/youtube/main.js` solo decide qué reglas aplican por hostname. Las
  excepciones `#@%#` del propio Base se respetan. De uAssets solo entran los scriptlets que
  `@adguard/scriptlets` implementa; el resto (`rpnt`, `trusted-*`) se descarta y el build lo lista.
- **Twitch (hoy solo sonda):** `src/twitch/page.js` reemplaza `window.Worker`, lee el script del
  worker del player con XHR síncrono y lo recrea como blob con `src/twitch/worker.js` delante, que
  envuelve `self.fetch`, registra los masters que carga el player (con los flags del token:
  `show_ads`, `server_ads`, `hide_ads`) y las clases de `#EXT-X-DATERANGE`, y cuando ve
  `twitch-stitched-ad` pide en paralelo el stream con `embed`, `popout`, `autoplay` (platform
  `android`), `picture-by-picture`, `frontpage`, `mobile_web` y `site` y clasifica cada respuesta
  (`clean` / `announced` / `ads` / `error`). Las peticiones GQL las ejecuta la página con su `fetch`
  original y sus cabeceras (`Client-Integrity`, `X-Device-Id`, `Authorization`…), como hace Purple.
  Nada nuestro llega al worker antes del primer `postMessage` del player (Purple vio morir el
  worker si llegaba antes). Los playlists pasan al player sin tocar. Resultados en consola bajo
  `[AdBlock/twitch]` y en `window.__adblockTwitch`. **Dato del 2026-10-15** (memoria
  `twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios`): en un PREROLL cosido real los
  siete `player_type` volvieron limpios, cinco a la calidad del player. La siguiente sesión porta el
  intercambio de stream de Purple sobre ese dato.

## Comandos

| | |
|---|---|
| `npm run build` | regenera `dist/` (≈1 s) |
| `npm run vendor` | refresca `vendor/uassets-quick-fixes.txt` desde GitHub (commitéalo) |
| `npm run verify -- generic\|youtube\|twitch\|all` | carga `dist/` en un Chromium con Playwright y comprueba en páginas reales |
| `npm run verify -- twitch --seconds=600 --twitch=<canal>` | sonda de Twitch sobre un canal concreto, más tiempo |

**Actualizar las listas** = `npm install @adguard/dnr-rulesets@latest @adguard/scriptlets@latest`,
`npm run vendor`, `npm run build`, recargar en `chrome://extensions`. Si YouTube o Twitch se
rompen, eso es lo primero: la carcasa se arregla con un build, no investigando.

**Verificación:** `test/verify.mjs` usa el Chromium de Playwright (`--channel=chromium`, que sí
trae H.264/AAC, comprobado) porque el Chrome de marca ≥ 137 ignora `--load-extension` y Edge no
está instalado. Cada ejecución parte de un perfil nuevo en `test/profiles/` (ignorado). Un check
que no ve anuncio lo dice tal cual: en YouTube la prueba que vale es que el player response llegue
sin `adPlacements` (sin la extensión trae 1), no "no vi anuncio".

**Al limpiar navegadores de prueba colgados, nunca `taskkill //IM chrome.exe`:** mata el Chrome de
Fran (memoria `no-matar-chrome-por-nombre-de-imagen` en `PyCharm Projects`).

## Memoria del proyecto

Las memorias de este repo viven en `.claude/memory/` — un hecho por fichero, más `MEMORY.md` de
índice — y se commitean con él. **Escribe, actualiza y lee ahí; nunca en `~/.claude`**: así
viajan con el repo a cualquier máquina y las hereda cualquier agente que lo clone.

Si lo que surge es específico de **otro** proyecto, su memoria va al `.claude/memory/` de aquel,
no a este: la memoria se guarda donde vive su tema, no donde se ejecuta la sesión.

@.claude/memory/MEMORY.md
