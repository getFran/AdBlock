---
name: distribucion-por-github-releases
description: Decidido el 2026-10-18: la extensión se reparte desde el repo público getFran/AdBlock como zip en GitHub Releases (no Web Store), con un build de release sin nada de depuración, un aviso de versión nueva dentro de la extensión (badge NEW leyendo la redirección de /releases/latest), una Action que publica con cada tag y los lunes con listas nuevas, licencia GPL-3.0 y todo lo público en inglés. Qué se descartó y por qué, y qué queda pendiente (el icono).
metadata:
  type: project
---

**Qué se decidió (2026-10-18, Fran: «había pensado en distribuirla por mi repo de github», «que la propia
extensión detectase que hay una versión nueva y avise», «lo que tú veas mejor», «hazlo todo en inglés»):**

- **Repo público, el mismo que el código.** Se valoró un repo aparte solo para releases y se descartó: un
  bloqueador con `<all_urls>` cuyo código nadie puede leer es más difícil de instalar con confianza. Antes de abrirlo
  se revisó todo el historial de git de `CLAUDE.md` y `.claude/`: ningún secreto (PAT, tokens de Cloudflare,
  contraseñas, IPs, correos); lo personal que hay (nombre de pila, usuario de Windows en rutas, canales de Twitch
  vistos, `umami.getfran.dev`, cuenta de YouTube marcada) se le contó y lo aceptó. Las memorias y `CLAUDE.md` se
  quedan dentro y en español; lo que ve otra persona (README, popup, avisos, notas, commits) va en inglés.
- **Zip en GitHub Releases, cargado descomprimido.** Chrome no instala `.crx` de fuera de la Store, así que la
  Store se descarta y el camino es Releases + "Load unpacked". Dentro del zip va una carpeta de nombre fijo
  `getfran-adblock/` para que la actualización sea descomprimir encima: mismo directorio, mismo ID de extensión,
  se conservan los sitios desactivados.
- **Build de release** (`npm run build:release`) sin registros, consola, globales, `bridge.js`, diagnóstico ni
  `getfran.dev` por defecto, y sin los permisos `downloads` y `declarativeNetRequestFeedback`. esbuild solo poda
  las ramas `__RELEASE__` con `minifySyntax: true` (sin él, `true ? null : (...)` se queda en el bundle).
- **Aviso de versión** sin API de GitHub: `fetch` a `/releases/latest` con `redirect: 'follow'` y la versión sale
  de `response.url` (`/releases/tag/vX.Y.Z`); sin cuota, una petición al día por alarma (`chrome.alarms`, sin aviso
  de permiso), más al abrir el popup con 6 h de margen. Badge `NEW` rojo + título del icono + banner en el popup
  con el enlace. Se descartó `chrome.notifications` (otro permiso, más intrusivo).
- **Action semanal** que solo publica si cambió algo material: compara `package.json`, el lock y `vendor/`
  ignorando las líneas `vendored on` (la fecha de descarga cambia siempre). Commitea las listas a `main` como
  `github-actions[bot]` y etiqueta; como el push lo hace `GITHUB_TOKEN`, no dispara el workflow de tags, por eso la
  misma ejecución construye y publica. Necesita `permissions: contents: write` en el YAML (el default del repo es
  solo lectura).
- **GPL-3.0** porque las listas y scriptlets de AdGuard y uAssets lo son; Purple (Apache-2.0) y vaft (MIT) se
  atribuyen en `THIRD_PARTY_NOTICES.md`, que entra en el zip.

**Primer aviso de un usuario (2026-10-20):** Fran instaló la release en otro PC y vio anuncios en Twitch (usaba
también el picture-in-picture). Comprobado desde aquí con `npm run probe` sobre el zip exacto de Releases (idéntico
byte a byte a `dist/`): el hook está activo (pide los seis tokens de respaldo al cargar), el vídeo sigue, y ni el
PiP del navegador ni el mini-player al navegar lo rompen; en una de seis cargas el hook no apareció (sin
reproducirlo después, con o sin esperar al registro de los content scripts, que tarda 150 ms). Lo que sí es seguro:
una pestaña de Twitch abierta **antes** de instalar no lleva el hook hasta recargarla (los scripts de MAIN world
solo entran a `document_start`). Desde ese día el service worker recarga una vez las pestañas de Twitch y YouTube
al instalar (`reason === 'install'`, nunca en updates) y `readScript` reintenta tres veces la lectura síncrona del
script del worker. La release no graba nada: para saber qué vio hay que preguntarle (vídeo de anuncio con cuenta
atrás, banner morado con el directo detrás, pantalla negra, al cargar el canal o a mitad) o cargar el build de
desarrollo en ese PC.

**Why:** son decisiones de producto y de alcance que no se deducen del código: por qué no Web Store, por qué repo
público y no uno de releases, por qué el zip lleva carpeta fija, por qué la comprobación de versión no usa la API,
y que la auditoría de `.claude/` ya se hizo (no hay que repetirla ni preocuparse por abrir el repo).

**How to apply:** nada en español en lo que ve otra persona (popup, README, notas de release, mensajes de commit).
Nada de depuración fuera de `!__RELEASE__` (en el worker, `RELEASE` vía `typeof`); `npm run smoke` sobre el build
de release lo comprueba. Para una versión a mano: `version` en `package.json`, commit, y `node scripts/publish.mjs
<PAT>` (idempotente: abre el repo si sigue privado, crea y empuja el tag, espera la Action y enseña la release; el
token va por argumento, nunca en el repo). Ese script lo lanza Fran desde la sesión con `!`, como los del router.
El 2026-10-18 quedó todo commiteado; el 2026-10-19 Fran puso `defaultMode: bypassPermissions` en su `settings.json`
(sin él, el clasificador de auto mode denegaba el script y hasta añadir la regla de permiso) y la `v1.0.0` salió ese
día a las 15:44 UTC: repo público, zip de 5,9 MB con la carpeta `getfran-adblock/`, manifest con los cuatro permisos y
sin código de depuración (comprobado descargando el zip), `releases/latest` resolviendo al tag, y un build de
desarrollo 0.9.0 viendo `latest=1.0.0 available=true`. Dos rarezas de GitHub, ninguna grave: justo después de hacer
público el repo, el push del tag dio `403 "Your repository is disabled"` durante un minuto (reintentar basta), y el
listado de runs de la API dejó la ejecución del tag como `queued` con fecha posterior a la release que ella misma
creó (no se puede cancelar: "not in progress"); el estado real es la release.
Antes de tocar `package.json` o `vendor/`, `git pull`: los lunes puede haber un commit del bot. La primera
ejecución programada (2026-10-19) falló con `npm error 429 Too Many Requests` del registro de npm hacia el runner:
las IPs compartidas de GitHub Actions tienen cuota en npmjs.org; desde entonces el paso de listas reintenta con
espera creciente y npm lleva `fetch-retries` subidos. Si llega un correo de "Release failed" un lunes, mirar primero
si es eso (el log acaba en `E429`) antes de buscar un fallo del build. **Pendiente que
decida Fran:** el icono es el meme dogwifhat, sin derechos claros, no apto para un repo público a largo plazo.
Relacionado: [[twitch-intercambio-verificado-primer-midroll-real]] (la evidencia que el build de release ya no
genera: para investigar un corte hay que cargar el build de desarrollo),
[[adguard-tracking-protection-bloquea-cualquier-host-umami]] (`getfran.dev` desactivado solo en desarrollo).
