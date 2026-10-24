# CLAUDE.md — Bloqueador de anuncios para Chrome (Twitch y YouTube)

Extensión de Chrome (Manifest V3) que bloquea anuncios en cualquier web con las listas de AdGuard y
trata aparte YouTube y Twitch. Se distribuye desde GitHub (repo **público** desde el 2026-10-18): un zip
por release que se carga descomprimido; ni Chrome Web Store ni Portainer. **Todo lo que ve otra persona
va en inglés** (README, popup, avisos, notas de release, mensajes de commit); este fichero y las memorias
son notas internas y siguen en español. La infraestructura compartida está en el
`CLAUDE.md` de `PyCharm Projects`, que se carga solo: **no la dupliques aquí**.

Croquis de decisión: `ProjectKit/ideas/bloqueador-de-anuncios-para-chrome-twitch-y-youtube.md`.
**Léelo antes de proponer arquitectura**: la decisión de hacer este proyecto se tomó con ese
alcance (carcasa que consume piezas mantenidas por otros), no con otro.

## Coordenadas

| | |
|---|---|
| Nombre en Chrome | **getFran AdBlock** (el `name` del manifest; pedido el 2026-10-15) |
| Descripción | «Blocks ads on every website, including YouTube and Twitch.» (2026-10-17, en inglés y simple para que sea distribuible) |
| Icono | `icons/dogwifhatnike.png` (elección de Fran, 2026-10-15); los `icons/icon-{16,32,48,128}.png` están renderizados y commiteados, el build solo los copia. Para cambiarlo, regenerar los cuatro tamaños (recorte cuadrado centrado) y commitearlos |
| Repo | `getFran/AdBlock`, **público** desde el 2026-10-18 (Fran: «lo que tú veas mejor»; antes privado). Historial auditado: sin secretos; `.claude/` y este fichero se quedan dentro |
| Rama | `main` |
| Versión | `1.0.2` en `package.json` (publicada el 2026-10-22 por la tarde con `scripts/publish.mjs` desde esta sesión, que en bypass sí pudo empujar el tag; verificada antes en cuatro cortes reales de caedrel247: la playlist de la página se renumera al volver de un corte en vez de reiniciar el player; la 1.0.1 salió el 2026-10-21 con la recarga de pestañas al instalar y el reintento de `readScript`; la 1.0.0 el 2026-10-19); la Action construye la del tag (`EXT_VERSION`) |
| Licencia | **GPL-3.0** (`LICENSE`): las listas y scriptlets de AdGuard y uAssets son GPL-3.0; Purple es Apache-2.0 y vaft MIT, atribuidos en `THIRD_PARTY_NOTICES.md`, que va dentro del zip |
| Despliegue | **GitHub Releases**: `.github/workflows/release.yml` publica `getfran-adblock-<versión>.zip` (carpeta `getfran-adblock/` dentro, nombre fijo para descomprimir encima y conservar el ID) al empujar un tag `v*`, y los lunes si hay listas nuevas. En local, `npm run build` deja `dist/` para "Load unpacked" |

## Decisiones tomadas (2026-10-15)

- **Arquitectura de carcasa.** La extensión no reimplementa lógica de bloqueo. El build toma:
  rulesets DNR precompilados y el texto de filtro embebido de `@adguard/dnr-rulesets` (la versión
  del paquete **es** la foto de las listas: va fijada en `package.json`; la excepción son las reglas
  de YouTube del Base, que desde el 2026-10-18 salen de `vendor/adguard-base-youtube.txt`, foto de la
  lista viva que refresca `npm run vendor`, porque el paquete npm va semanas por detrás: 36 días entre
  la release de septiembre y la de octubre y AdGuard toca YouTube cada pocos días), los scriptlets de
  `@adguard/scriptlets`, las reglas de YouTube del filtro Base de AdGuard más la familia
  `json-prune` y las dos reglas cosméticas de `uAssets/filters/quick-fixes.txt` (snapshot en `vendor/`), y para Twitch el hook
  del Worker portado de Purple Ads Blocker (`github.com/arthurbolsoni/Purple-adblock`, **Apache-2.0**,
  no GPL-3: la procedencia está citada en cada fichero de `src/twitch/`).
- **El bloqueo de Twitch es intercambio de stream, portado de Purple** (decidido el 2026-10-15 con el
  dato de la sonda; ficheros de origen: `serviceWorker/src/modules/player/{player,ad-detector,m3u8,
  sequence,blank-segment,ad-break,segments}.ts`, `stream/{master,stream.types}.ts`,
  `twitch/{twitch.service,page-gql}.ts`, `page/{fetch-hook,xhr-hook,player-reload}.ts` y los findings
  de `docs/findings` sobre *sequence numbering*, *backup behind*, *blank segments* y *prewarm*). Al ver
  `twitch-stitched-ad` con segmentos de anuncio en la playlist del player, el worker le sirve la playlist
  del backup limpio de su misma calidad en el orden **site, popout, frontpage, mobile_web, embed** y
  **autoplay** (platform `android`, 360p) como último recurso; fija el tipo que funcionó y descarta **2 s**
  (Purple: 5; con 5 s el pool de 1080p60 se vaciaba y el player bajaba a 360p cinco veces en un corte,
  2026-10-16) el que venga con segmentos de anuncio. El que solo **anuncia** su corte no se descarta: se
  sirve saneado como el aviso de la página (prefetch, `DISCONTINUITY` y `MAP` del anuncio fuera, `DATERANGE`
  del anuncio fuera) y se le pide token nuevo. Si aun así no hay nada a la calidad del player, o lo que hay
  va **por detrás** del último número entregado (2026-10-18, ibai: los cuatro tokens nuevos un segmento
  atrás y el F-24 reinició el player sin necesidad), se **repite la última playlist** de esa calidad si
  tiene menos de 3 s (`held`), y solo entonces el backup atrasado o `autoplay`: un cambio de resolución
  dentro de la variante es el sospechoso del decodificador atascado. Sin nada, merge por
  `PROGRAM-DATE-TIME` y, para lo que quede, el **blank segment** de Purple (viene de vaft, MIT, aviso en
  el fichero). `MEDIA-SEQUENCE` del backup alineado a la numeración de la página, `EXT-X-MAP` como lo
  hace Purple en el merge. Fuera de un corte las playlists llegan al player sin tocar, **salvo el
  `MEDIA-SEQUENCE`** desde el 2026-10-22: al volver de un corte, la playlist de la página se renumera
  (`pageRebase`, misma alineación por `PROGRAM-DATE-TIME` que la de los backups) para que continúe lo último
  entregado, y ese desplazamiento se mantiene hasta el siguiente master. Motivo: en caedrel247 (segmentos de
  1 s, anuncios de 2 s) la cuenta de la página quedaba 19 números por detrás de los backups tras 76 s de corte
  y el F-24 reiniciaba el player **al final de cada corte** (tres de tres el 2026-10-19). Con segmentos de la
  misma duración a ambos lados el desplazamiento sale 0 y no cambia nada. **Ni recorte de
  segmentos ni proxies.** Pause/play solo si hace falta: cuando el número de secuencia retrocede al
  cambiar de fuente (F-24 de Purple; desde el 2026-10-18 solo si no había playlist reciente que repetir) y,
  desde la página, si el vídeo lleva 6 s parado tras el corte (pause/play y, si sigue, reload suave); desde el
  2026-10-16 el guardián vigila desde el primer poll con anuncio hasta 60 s después del fin y cuenta como
  parado también que los **fotogramas decodificados**
  (`getVideoPlaybackQuality`) dejen de crecer con el reloj corriendo, que es lo que Fran vio como
  "congelado hasta F5". El anuncio client-side (`twitch-maf-ad`) se corta respondiendo
  vacío a `edge.ads.twitch.tv` desde `fetch` y XHR de la página; el Base de AdGuard ya lo bloquea por DNR
  (`||edge.ads.twitch.tv^`, la prueba lo imprime con `testMatchOutcome`) y esto es la segunda capa. Como
  Purple, el master `picture-by-picture` que pide la página se responde vacío y dispara el prewarm de
  tokens; los tokens también se piden al cargar el canal. Sin UI ni ajustes: los valores son los
  defaults de Purple del 2026-10-10. No portado: `forcePopoutToken`, `reloadAfterAd`, la whitelist.
- **Registro automático para revisar un anuncio a posteriori** (2026-10-15, noche). Fran no copia nada
  de la consola: `page.js` muestrea cada segundo el vídeo y la UI de anuncio de Twitch y, 20 s después
  de acabar un corte cosido, cuando esa UI lleva 3 s visible, o a mano (`window.__adblockTwitch.save()`),
  construye un JSON (muestras, eventos, log, estado del worker y sus últimas 80 playlists: las del
  player, las de los backups y lo entregado) y lo manda por `bridge.js` (mundo aislado, el único
  con `chrome.runtime` en twitch.tv y en YouTube) al service worker, que lo escribe con `chrome.downloads` (permiso
  `downloads`) en **`Descargas\AdBlock\twitch-<fecha>-<motivo>.json`**. Flujo: Fran dice a qué hora le
  saltó; la sesión lee el fichero más cercano en `C:\Users\javie\Downloads\AdBlock\`. Máximo uno
  automático por minuto; va como data URL, así que se recorta a 1,2 MB (límite de URL de Chrome).
- **Interruptor por sitio** (2026-10-16, pedido por Fran tras quedarse Umami a medias). Popup de la
  extensión (`src/popup/`): "Desactivar en <host>" guarda el host en `chrome.storage.local`
  (`disabledSites`, sin `www.`, cubre subdominios) y el service worker lo aplica de dos formas: **los
  content scripts ya no van en el manifest**, los registra `chrome.scripting.registerContentScripts`
  (lista `CONTENT_SCRIPTS` de `build.mjs` inyectada en `background.js`) con `excludeMatches` de los sitios
  desactivados, y por cada sitio una regla DNR dinámica `allowAllRequests` (id 1000+i, prioridad
  10.000.000, `requestDomains`) que deja pasar todo lo de sus frames por encima de cualquier regla
  estática. Al cambiar la lista se recarga la pestaña. **`getfran.dev` viene desactivado de fábrica**: la
  Tracking Protection de AdGuard lleva `||umami.` sin condición de tercero y rompe el panel de Umami
  autoalojado (memoria `adguard-tracking-protection-bloquea-cualquier-host-umami`); la lista no se toca,
  se usa el interruptor. `npm run verify -- generic` lo comprueba sobre `umami.getfran.dev` (19 peticiones
  bloqueadas con todo activo, 0 y sin hoja cosmética con el sitio desactivado). Permisos nuevos:
  `scripting`, `storage`.
- **El popup "Ad blockers are not allowed on YouTube"** (`ytd-enforcement-message-view-model`, botones
  "Allow YouTube Ads" / "Try YouTube Premium"; Fran lo vio el 2026-10-18). Mecanismo, leído en el `base.js`
  de ese día: el player dispara `onAbnormalityDetected` cuando un slot de preroll no se reprodujo o cuando el
  stream SABR le dice que tocaban anuncios y su player response no los trae (`html5_enable_t1_enf_on_sabr`:
  detecta la poda), y la app muestra el popup con la carga que viaja en
  `auxiliaryUi.messageRenderers.enforcementMessageViewModel` de cada player response de una cuenta marcada.
  Dos capas: la regla de AdGuard que anula el manejador (proxy de `Promise.then`, ya en el build) y **cuatro
  reglas locales nuestras** (`build.config.mjs` → `youtube.local`, sintaxis AdGuard, mismo pipeline) que podan
  esa carga del inline, de `JSON.parse`, de `fetch` y de XHR: es lo que los usuarios de uBO aplicaban a mano
  en 2023 y hoy no lleva ninguna lista (comprobado en el Base vivo de AdGuard y en todo uAssets). No se oculta
  por CSS: un `tp-yt-paper-dialog` escondido deja el scroll bloqueado. **Solo sale en cuentas marcadas: con
  perfil nuevo no se reproduce** (seis vídeos seguidos, cargas completas y SPA, sin popup ni pantalla de
  error), así que la evidencia es el registro: `src/youtube/record.js` guarda los últimos 20 `/player` y
  `/next` tal como los manda el servidor (claves, `playabilityStatus`, `auxiliaryUi`, y cualquier subárbol
  cuya clave parezca enforcement) y, cuando aparece el popup o la pantalla de error, escribe
  **`Descargas\AdBlock\youtube-<fecha>-<motivo>.json`** por `bridge.js`. Flujo: Fran dice la hora; la
  sesión lee el fichero. Aparte, el otro aviso de esta temporada, el **snackbar** "¿Tienes interrupciones?",
  lo tapan dos reglas cosméticas de uBO (`quick-fixes.txt`, 2026-10-15) que el build cosmético toma del
  snapshot de uAssets; el player no se bloquea porque la regla de AdGuard reescribe cada `/player`
  (`params=eAFgAQ`; comprobado con un hook de `TextEncoder.encode`, que es por donde sale el cuerpo:
  Playwright lo ve como `postData` nulo) y el servidor ya no devuelve `adPlacements`. Memoria
  `youtube-popup-enforcement-y-listas-vivas`.
- **Distribución por GitHub, sin nada de depuración en lo que se reparte (2026-10-18).** Fran quería repartirla
  desde su repo y que la extensión avisara de versiones nuevas. Piezas: (1) `npm run build:release` (`--release`,
  `define __RELEASE__` + `minifySyntax` para que esbuild pode las ramas): sin registro de Twitch ni de YouTube, sin
  `bridge.js`, sin consola, sin `window.__adblockTwitch`/`__adblockYoutube` ni exports del worker, sin
  `getfran.dev` desactivado de fábrica (eso es solo del build de desarrollo), y el manifest sin `downloads` ni
  `declarativeNetRequestFeedback`; el build de desarrollo sigue igual que antes. El worker lee `__RELEASE__` con
  `typeof` porque `test/twitch-playlists.mjs` lo ejecuta sin bundlear. (2) **Aviso de versión:** el service worker
  pide `github.com/getFran/AdBlock/releases/latest` una vez al día (`chrome.alarms`, permiso sin aviso) y lee la
  versión de la URL final (`/releases/tag/vX.Y.Z`: sin API ni cuota); si es mayor que la del manifest, badge rojo
  `NEW` y el popup enlaza la release; el popup también comprueba al abrirse (con 6 h de margen) y tiene "Check for
  updates". (3) **Action** `release.yml`: con un tag `v*` construye esa versión; los lunes instala
  `@adguard/*@latest`, `npm run vendor`, y si algo cambió (ignorando la fecha de los encabezados) commitea a
  `main`, sube el patch, etiqueta y publica; si no, no hace nada. (4) **GPL-3.0** por las listas. (5) Popup en
  inglés. `npm run smoke` carga `dist/` en Playwright y comprueba manifest, permisos, content scripts, alarma y que
  los globales no estén en la release. **Pendiente que Fran decida:** el icono es una imagen del meme dogwifhat y no
  está claro quién tiene sus derechos; en un repo público conviene uno propio.
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
  youtube.js     MAIN world: 35 reglas compiladas (27 del Base de AdGuard, 4 de uAssets, 4 locales) y el registro
                 (src/youtube/record.js: últimos /player y /next tal como llegan, popup y pantalla de error)
  twitch.js      MAIN world: hook de Worker/fetch/XHR de la página con src/twitch/worker.js inlined (el bloqueo)
  bridge.js      ISOLATED (twitch.tv y YouTube), SOLO build de desarrollo: relé página -> service worker de los registros
  background.js  service worker: registra los content scripts (con los sitios desactivados excluidos), aplica las reglas
                 allowAllRequests del interruptor, comprueba a diario si hay release nueva (badge NEW) y, en desarrollo,
                 escribe los registros de Twitch/YouTube (chrome.downloads -> Descargas\AdBlock\) y da diagnóstico a verify
  popup.html/js  el interruptor por sitio y el aviso de versión nueva (en inglés)
  icons/         el perro con el gorro, en 16/32/48/128
  LICENSE, THIRD_PARTY_NOTICES.md   copiados del repo: van dentro del zip
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
  Al cubo de `youtube.com` entran además las reglas `##` de los hosts de YouTube de
  `vendor/uassets-quick-fixes.txt` (las del snackbar del aviso); el build dice cuántas.
- **YouTube:** `json-prune` sobre `JSON.parse`/`Response.json`, `json-prune-fetch-response`,
  `json-prune-xhr-response`, `set-constant` para el `ytInitialPlayerResponse` inline, las
  contramedidas (`onAbnormalityDetected`, iframe `about:blank`, temporizador de 17 s)… todo
  compilado en build; `src/youtube/main.js` solo decide qué reglas aplican por hostname. Las
  excepciones `#@%#` del propio Base se respetan. De uAssets solo entran los scriptlets que
  `@adguard/scriptlets` implementa; el resto (`rpnt`, `trusted-*`) se descarta y el build lo lista.
  **El panel "Errores" de `chrome://extensions` muestra "Blocked script execution in 'about:blank' because
  the document's frame is sandboxed…" con la pila en `youtube.js` (`Reflect.apply` del proxy de
  `Node.prototype.appendChild`, regla del Base de AdGuard):** es YouTube insertando su propio iframe
  `about:blank` con `sandbox` sin `allow-scripts`; Chrome lo atribuye a la extensión porque la regla
  intercepta `appendChild` y nuestro frame está en la pila. Sin efecto (la prueba `youtube` pasa); no se
  arregla desde el trap porque el aviso salta dentro del `appendChild` original. Visto el 2026-10-17.
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
| `npm run build` | regenera `dist/` (≈1 s), build de desarrollo: registros, diagnóstico, consola |
| `npm run build:release` | el `dist/` que se reparte: sin nada de eso (`EXT_VERSION=1.2.3` fija la versión) |
| `npm test` | `test/twitch-playlists.mjs`: las piezas puras del worker, sin navegador |
| `npm run records -- [--since=YYYY-MM-DD] [--verbose]` | `test/twitch-records.mjs`: resume cada corte de los registros de `Descargas\AdBlock\` (cadena de backups, `held`/`merged`/`blanked`, reinicios, `pageRebased`, y sobre las muestras: parones de reloj o de imagen, anchura, UI de anuncio). Cada registro lleva todos los cortes de su pestaña pero solo 300 s de muestras: cada corte se lee del primer registro que lo contiene. Es lo primero que se lanza cuando Fran trae registros nuevos |
| `npm run smoke` | carga `dist/` en el Chromium de Playwright y comprueba manifest, permisos, content scripts, alarma y globales (vale para los dos builds; `ADBLOCK_DIST=<carpeta>` prueba un zip descomprimido) |
| `npm run probe -- [--twitch=<canal>] [--seconds=90] [--pip] [--navigate] [--race]` | abre un directo con el build de `dist/` (o `ADBLOCK_DIST`) y dice si el hook del worker está activo **sin depender de los globales** (los masters de usher: los tokens de respaldo solo se piden si nuestro worker corre), si el vídeo avanza y si sale la UI de anuncio; `--pip` y `--navigate` ejercitan el picture-in-picture y el mini-player. Es la única forma de probar la release en Twitch |
| `npm run vendor` | refresca `vendor/uassets-quick-fixes.txt` (GitHub) y `vendor/adguard-base-youtube.txt` (las reglas de YouTube de la lista Base viva de AdGuard); commitéalos |
| `npm run verify -- generic\|youtube\|twitch\|all` | carga `dist/` en un Chromium con Playwright y comprueba en páginas reales (`generic` incluye el interruptor por sitio sobre umami.getfran.dev; `youtube` comprueba las reglas anti-popup, los selectores del snackbar y que el registro llega a `Descargas\AdBlock\`) |
| `npm run verify -- twitch --seconds=900 --twitch=<canal>[,<canal>...]` | vigila cada canal hasta 900 s y para 30 s después del primer corte cosido completo; imprime por corte backups usados, URIs de anuncio en la red, parón más largo, UI de anuncio y si el vídeo sigue tras el corte |
| `node test/twitch-playlists.mjs` | comprobaciones sin navegador de las piezas puras del worker sobre playlists sintéticas |

**Actualizar las listas** = `npm install @adguard/dnr-rulesets@latest @adguard/scriptlets@latest`,
`npm run vendor`, `npm run build`, recargar en `chrome://extensions`. **La Action lo hace sola los lunes** y publica
release si algo cambió (commit de `github-actions[bot]` en `main`: hay que hacer `git pull` antes de tocar nada).
Para publicar a mano una versión: subir `version` en `package.json`, commit, y `node scripts/publish.mjs <PAT>`
(idempotente: hace público el repo si aún no lo es, crea y empuja el tag, espera la Action y enseña la release; el
token va por argumento, nunca en el repo). **El clasificador de auto mode deniega hacer público el repo y empujar
tags** («Create Public Surface») aunque esté autorizado aquí: ese script lo lanza Fran con
`! node scripts/publish.mjs <PAT>`. Si YouTube o Twitch se
rompen, eso es lo primero: la carcasa se arregla con un build, no investigando. **Para YouTube basta
`npm run vendor && npm run build`**: trae las reglas de hoy de AdGuard (lista viva) y de uBO sin
esperar a que AdGuard publique el paquete npm, que tarda semanas.

**Verificación:** `test/verify.mjs` usa el Chromium de Playwright (`--channel=chromium`, que sí
trae H.264/AAC, comprobado) porque el Chrome de marca ≥ 137 ignora `--load-extension` y Edge no
está instalado. Cada ejecución parte de un perfil nuevo en `test/profiles/` (ignorado). Un check
que no ve anuncio lo dice tal cual: en YouTube la prueba que vale es que el player response llegue
sin `adPlacements` (sin la extensión trae 1), no "no vi anuncio".

**Un corte cosido no se puede provocar:** sale cuando Twitch lo mete (en `auronplay` tardó 5 min el
2026-10-15 por la mañana; esa misma tarde, 2 h 20 min y 23 cargas sin ninguno). Si en la pasada no sale
ninguno, la prueba lo dice tal cual; hay que repetir con otros canales grandes (`--twitch=a,b,c`). **Siete
midrolls reales del 2026-10-16 al 18** (memoria `twitch-intercambio-verificado-primer-midroll-real`): playlists
limpias en todos, pero en uno de 84 s la cadena cayó cinco veces a 360p y **Fran vio la imagen congelada
hasta pulsar F5** con el reloj corriendo: `currentTime` no detecta un decodificador atascado, por eso las
muestras llevan `frames`, el guardián reinicia también por imagen parada y `verify` cuenta "picture frozen"
como fallo; el cuarto, ya con fotogramas, se vio perfecto, y los tres siguientes (ohnepixel 74 s, ibai 107 s y
52 s, todos a 1080p60) limpios: el único artefacto fue un reinicio por retroceso de secuencia con los backups un
número atrás, cubierto desde el 18 con el `held`. **Doce más del 2026-10-18 (tarde) al 22** (ibai, caedrel y
caedrel247, todos a 1080p60; las nueve de caedrel del 22 ya con la 1.0.1): todos los polls con anuncio
intercambiados a la calidad del player, sin `held`, sin 360p, sin parón de reloj ni de imagen, sin UI de anuncio;
el único artefacto fue el reinicio al final de cada corte de caedrel247 (segmentos de 1 s) que arregla el
`pageRebase`, verificado esa misma tarde en cuatro cortes de caedrel247 con la 1.0.2 (renumerado +11/+11/+20/+5
al acabar cada uno, ningún reinicio, `t` y fotogramas sin saltos). **Catorce más el 23** (jaimemellado_, 1080p60,
1.0.2): doce limpios del todo; en los tres cortes de varios pods, al arrancar el segundo pod **los cinco tipos web
volvieron con anuncio a la vez** (un token pedido con el pod en marcha se une a él y trae el anuncio cosido, y los
que ya estaban lo reciben igual): una vez lo cubrió el `held`, y dos veces agotó sus 3 s y el player vio `autoplay`
360p durante 6 s y 40 s, con 1 s de buffering al cambiar, sin reinicio, sin parón y sin UI de anuncio. Es el último
recurso por diseño (contenido a 360p antes que pantalla en negro): en ese tramo no existe sesión a 1080p sin
anuncio, el worker lo comprobó pidiendo los cinco tokens cada 3-4 s. Un registro cae en `Descargas\AdBlock\` tras
**cada** corte, también cuando va bien. **Quince más en ibai** del 23 por la tarde al 24 de madrugada (1080p60, 1.0.2,
siete horas seguidas): el lote más limpio hasta hoy, todos los polls intercambiados a 1080p60, sin `held`, sin
`offQuality`, sin reinicios y sin parones, con solo 1-5 cambios de fuente por corte. **Seis más en champi14 el 24**,
todos limpios, con los de 3 y 6 pods limpios del todo: que el segundo pod cosa el anuncio en los cinco tokens web a
la vez depende del canal, no del número de pods. Uno de ellos, **el primero a 720p60** (11:19, 52 s, con el player
bajado a mano), cierra la otra duda: los masters de los backups ofrecían `1080p60/720p60/480p/360p/160p` y el worker
sirvió `site@720p60` y `popout@720p60` los 30 polls, 0 `offQuality`, las 77 muestras a 1280 px sin parones. La cadena
empareja la calidad del player, no coge la mejor. **Dos más esa tarde lo rematan**: otro a 720p60 (11:45, 27/27) y
**el de 480p** (12:36, 52 s, 31/31 `swapped` a 480p con shift +5 constante, 0 `held`, 0 `offQuality`, las 77 muestras
a 852 px y 30 fps, sin reinicio ni parones). El emparejamiento de calidad queda probado en los tres escalones. **Y el primer PREROLL de carga** (trackingthepros, 24, 51 s): toda sesión que
empieza durante el pod nace dentro de él, así que los cinco tokens web vuelven con anuncio y solo `autoplay@360p`
está limpio los primeros 31 s, hasta que `site` vuelve a 1080p60; el player arrancaba en 360p por su cuenta y no se
notó, pero `autoplay` no pasa de 360p y el `held` no cubre un arranque en frío. Al acabar, la página devuelve su
playlist numerada en **27** mientras el player sostiene **15537** (la página numera desde la sesión, los backups desde
el principio de la emisión, mismo `PROGRAM-DATE-TIME`) y el `pageRebase` la renumera **+15510** sin reinicio: el
rebase del 22 no era un apaño para caedrel247, es lo que hace que un preroll funcione. El `PlayerError
MasterPlaylist "not a valid M3U8"` de cada corte es el master `picture-by-picture` respondido vacío a propósito, lo
acusa el mini player y no el principal.

**Al limpiar navegadores de prueba colgados, nunca `taskkill //IM chrome.exe`:** mata el Chrome de
Fran (memoria `no-matar-chrome-por-nombre-de-imagen` en `PyCharm Projects`).

## Memoria del proyecto

Las memorias de este repo viven en `.claude/memory/` — un hecho por fichero, más `MEMORY.md` de
índice — y se commitean con él. **Escribe, actualiza y lee ahí; nunca en `~/.claude`**: así
viajan con el repo a cualquier máquina y las hereda cualquier agente que lo clone.

Si lo que surge es específico de **otro** proyecto, su memoria va al `.claude/memory/` de aquel,
no a este: la memoria se guarda donde vive su tema, no donde se ejecuta la sesión.

@.claude/memory/MEMORY.md
