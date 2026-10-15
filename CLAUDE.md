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
| Nombre en Chrome | **getFran AdBlock** (el `name` del manifest; pedido el 2026-10-15) |
| Icono | `icons/dogwifhatnike.png` (elección de Fran, 2026-10-15); los `icons/icon-{16,32,48,128}.png` están renderizados y commiteados, el build solo los copia. Para cambiarlo, regenerar los cuatro tamaños (recorte cuadrado centrado) y commitearlos |
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
- **El bloqueo de Twitch es intercambio de stream, portado de Purple** (decidido el 2026-10-15 con el
  dato de la sonda; ficheros de origen: `serviceWorker/src/modules/player/{player,ad-detector,m3u8,
  sequence,blank-segment,ad-break,segments}.ts`, `stream/{master,stream.types}.ts`,
  `twitch/{twitch.service,page-gql}.ts`, `page/{fetch-hook,xhr-hook,player-reload}.ts` y los findings
  de `docs/findings` sobre *sequence numbering*, *backup behind*, *blank segments* y *prewarm*). Al ver
  `twitch-stitched-ad` con segmentos de anuncio en la playlist del player, el worker le sirve la playlist
  del backup limpio de su misma calidad en el orden **site, popout, frontpage, mobile_web, embed** y
  **autoplay** (platform `android`, 360p) como último recurso; fija el tipo que funcionó y descarta 5 s el
  que venga con anuncio o con su propio corte anunciado. Sin backup limpio, merge por
  `PROGRAM-DATE-TIME` y, para lo que quede, el **blank segment** de Purple (viene de vaft, MIT, aviso en
  el fichero). `MEDIA-SEQUENCE` del backup alineado a la numeración de la página, `EXT-X-MAP` como lo
  hace Purple en el merge. Fuera de un corte las playlists llegan al player sin tocar. **Ni recorte de
  segmentos ni proxies.** Pause/play solo si hace falta: cuando el número de secuencia retrocede al
  cambiar de fuente (F-24 de Purple) y, desde la página, si el vídeo lleva 6 s parado tras el corte
  (pause/play y, si sigue, reload suave). El anuncio client-side (`twitch-maf-ad`) se corta respondiendo
  vacío a `edge.ads.twitch.tv` desde `fetch` y XHR de la página; el Base de AdGuard ya lo bloquea por DNR
  (`||edge.ads.twitch.tv^`, la prueba lo imprime con `testMatchOutcome`) y esto es la segunda capa. Como
  Purple, el master `picture-by-picture` que pide la página se responde vacío y dispara el prewarm de
  tokens; los tokens también se piden al cargar el canal. Sin UI ni ajustes: los valores son los
  defaults de Purple del 2026-10-10. No portado: `forcePopoutToken`, `reloadAfterAd`, la whitelist.
- **Registro automático para revisar un anuncio a posteriori** (2026-10-15, noche). Fran no copia nada
  de la consola: `page.js` muestrea cada segundo el vídeo y la UI de anuncio de Twitch y, 20 s después
  de acabar un corte cosido, cuando esa UI lleva 3 s visible, o a mano (`window.__adblockTwitch.save()`),
  construye un JSON (muestras, eventos, log, estado del worker y sus últimas 80 playlists: las del
  player, las de los backups y lo entregado) y lo manda por `twitch-bridge.js` (mundo aislado, el único
  con `chrome.runtime` en twitch.tv) al service worker, que lo escribe con `chrome.downloads` (permiso
  `downloads`) en **`Descargas\AdBlock\twitch-<fecha>-<motivo>.json`**. Flujo: Fran dice a qué hora le
  saltó; la sesión lee el fichero más cercano en `C:\Users\javie\Downloads\AdBlock\`. Máximo uno
  automático por minuto; va como data URL, así que se recorta a 1,2 MB (límite de URL de Chrome).
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
  twitch.js      MAIN world: hook de Worker/fetch/XHR de la página con src/twitch/worker.js inlined (el bloqueo)
  twitch-bridge.js  ISOLATED: relé página -> service worker del registro (chrome.downloads -> Descargas\AdBlock\)
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
- **Twitch (bloqueo):** `src/twitch/page.js` reemplaza `window.Worker`, lee el script del worker del
  player con XHR síncrono y lo recrea como blob con `src/twitch/worker.js` delante; nada nuestro llega
  al worker antes del primer `postMessage` del player (Purple vio morir el worker si llegaba antes). El
  worker es dueño de `self.fetch`: el master de usher fija canal, URL y variantes y pide un token por
  tipo de backup (prewarm); cada media playlist del player pasa por `playlistFor`: `NONE` → intacta;
  `MARKED_LIVE` (maf-ad o corte anunciado tras el último segmento) → intacta salvo las líneas prefetch
  que apuntan al anuncio, cuyas URIs se responden en blanco; `SSAI` → cadena de backups (el primero
  solo, el resto en paralelo), playlist entera del primero limpio con `MEDIA-SEQUENCE` desplazado, o
  merge + blank. Las `DATERANGE` del anuncio se quitan de lo que se entrega editado (si no, la UI de
  anuncio arranca igual). Las peticiones GQL las ejecuta la página con su `fetch` original y sus
  cabeceras (`Client-Integrity`, `X-Device-Id`, `Authorization`…). Evidencia: consola bajo
  `[AdBlock/twitch]` (página) y `[AdBlock/twitch:worker]`, y `window.__adblockTwitch` (`breaks`,
  `breakEnds`, `events`, `blankUris`, `csaiBlocked`, `restarts`, `samples`, `saves`, `log`), y el registro
  JSON que cae en `Descargas\AdBlock\` tras un corte o al verse la UI de anuncio. Las piezas puras (detector,
  merge, blank, secuencia, variantes) se exportan en `self.__adblockTwitchWorker` para
  `test/twitch-playlists.mjs`. Dato de la sonda que decidió esto: memoria
  `twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios`.

## Comandos

| | |
|---|---|
| `npm run build` | regenera `dist/` (≈1 s) |
| `npm run vendor` | refresca `vendor/uassets-quick-fixes.txt` desde GitHub (commitéalo) |
| `npm run verify -- generic\|youtube\|twitch\|all` | carga `dist/` en un Chromium con Playwright y comprueba en páginas reales |
| `npm run verify -- twitch --seconds=900 --twitch=<canal>[,<canal>...]` | vigila cada canal hasta 900 s y para 30 s después del primer corte cosido completo; imprime por corte backups usados, URIs de anuncio en la red, parón más largo, UI de anuncio y si el vídeo sigue tras el corte |
| `node test/twitch-playlists.mjs` | comprobaciones sin navegador de las piezas puras del worker sobre playlists sintéticas |

**Actualizar las listas** = `npm install @adguard/dnr-rulesets@latest @adguard/scriptlets@latest`,
`npm run vendor`, `npm run build`, recargar en `chrome://extensions`. Si YouTube o Twitch se
rompen, eso es lo primero: la carcasa se arregla con un build, no investigando.

**Verificación:** `test/verify.mjs` usa el Chromium de Playwright (`--channel=chromium`, que sí
trae H.264/AAC, comprobado) porque el Chrome de marca ≥ 137 ignora `--load-extension` y Edge no
está instalado. Cada ejecución parte de un perfil nuevo en `test/profiles/` (ignorado). Un check
que no ve anuncio lo dice tal cual: en YouTube la prueba que vale es que el player response llegue
sin `adPlacements` (sin la extensión trae 1), no "no vi anuncio".

**Un corte cosido no se puede provocar:** sale cuando Twitch lo mete (en `auronplay` tardó 5 min el
2026-10-15 por la mañana; esa misma tarde, 2 h 20 min y 23 cargas sin ninguno, memoria
`twitch-intercambio-sin-verificar-en-vivo`). Si en la pasada no sale ninguno, el bloqueo **no está
verificado** y la prueba lo dice tal cual; hay que repetir con otros canales grandes (`--twitch=a,b,c`).

**Al limpiar navegadores de prueba colgados, nunca `taskkill //IM chrome.exe`:** mata el Chrome de
Fran (memoria `no-matar-chrome-por-nombre-de-imagen` en `PyCharm Projects`).

## Memoria del proyecto

Las memorias de este repo viven en `.claude/memory/` — un hecho por fichero, más `MEMORY.md` de
índice — y se commitean con él. **Escribe, actualiza y lee ahí; nunca en `~/.claude`**: así
viajan con el repo a cualquier máquina y las hereda cualquier agente que lo clone.

Si lo que surge es específico de **otro** proyecto, su memoria va al `.claude/memory/` de aquel,
no a este: la memoria se guarda donde vive su tema, no donde se ejecuta la sesión.

@.claude/memory/MEMORY.md
