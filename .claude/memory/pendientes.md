---
name: pendientes
description: Lo que quedó sin verificar o sin documentar al cerrar una sesión; se lee al abrir y se tacha al resolverse. Actualizado el 2026-11-24 (anuncios en YouTube en la cuenta de Fran, a la espera del registro ad-shown).
metadata:
  type: project
---

**Why:** Fran lo pidió el 2026-11-04 ("todo lo que tengas pendiente déjalo en una lista de pendientes por si cierro la
sesión sin verificar lo que pides"): él no siempre puede hacer en el momento lo que una sesión le pide (recargar la
extensión, forzar un registro), y la siguiente sesión tiene que saber qué quedó a medias sin releer el historial.

**How to apply:** leer esto al abrir sesión. Cada punto dice qué falta, cómo se comprueba y qué resultado lo cierra.
Al cerrarlo, quitarlo de aquí (si deja lección, va a su memoria o al `CLAUDE.md`) y commitear. Lo que Fran tiene que
hacer él va marcado **(Fran)**.

## Pendiente a 2026-11-24

0c. **Anuncios en YouTube en la cuenta de Fran el 2026-11-24, sin registro que los explique.** Lo dijo esa tarde ("me han
   salido anuncios en youtube hoy"). Lo que se descartó esa sesión: las reglas de YouTube del Base vivo de AdGuard no
   habían cambiado desde el 23 (2.5.6.60 → .84 es solo el número; `npm run vendor` no trajo nada de YouTube), las reglas
   de red (`/pagead/`, `/player/ad_break`) están en el `ruleset_2` de `dist/`, la extensión estaba activa en su Chrome
   (Secure Preferences, sin `disable_reasons`), `disabledSites` era solo `["getfran.dev"]`, Chrome seguía en la 157 del
   17, y `npm run verify -- youtube` salió limpio dos veces (sin cuenta: `adPlacements` ausente en dos vídeos, 32 reglas,
   4/4 anti-popup). Ni AdGuard ni uBO tenían una oleada abierta (el hilo de uBO sin comentarios desde el 21; en el de
   AdGuard #247932 entran quejas sueltas de YouTube desde el 23 sin diagnóstico). Así que es algo de la cuenta: ese día se
   añadió al registro el motivo **`ad-shown`** (`src/youtube/record.js`: 2 s de `ad-showing` o de UI de anuncio en el
   player; guarda `playingId` frente a `videoId`, la `src` del vídeo, la UI visible, `adBreakHeartbeatParams`/`sabr`/
   `formats` de cada `/player` tal como llegó, y los experiment flags de ads/SSAP/SABR/enforcement). **(Fran)** recargar
   la extensión en `chrome://extensions` (el `dist/` ya lleva el registro) y, cuando vuelva a ver un anuncio, decir la hora.
   Se cierra leyendo `Descargas\AdBlock\youtube-<fecha>-ad-shown.json`: si el `/player` del servidor trae
   `adPlacements`/`adSlots` y el player también → fallan las reglas (lo primero, `rules.failed` y si las 32 aplican); si
   el servidor los trae y el player no, pero `playingId` cambia → anuncio client-side que la poda no cubre; si
   `playingId` no cambia y el servidor no trae `adPlacements` → anuncio cosido en el stream (SSAP), que ninguna lista
   quita hoy. Si lo que vio eran banners y no vídeo, el registro no salta: preguntarle qué vio.
   **Segunda vuelta esa misma tarde:** Fran precisó "justo antes del vídeo y banners en la página, midrolls no", que
   es la pinta de que no corre ningún script nuestro (los banners los quitan la cosmética y la poda de `/next`; un
   anuncio cosido no los trae). En su perfil estaba todo en orden (`withholding_permissions: false`, `<all_urls>`, los 8
   rulesets con `ignore_ruleset: false`, 175.343 reglas asignadas del fondo común, los cuatro `_dc_*` registrados con
   solo getfran.dev excluido, extensión recargada a las 19:33), pero **el historial de Chrome no tiene ninguna visita a
   `/watch` ese día en ventana normal** (la última, el sábado 21 a las 23:01; Edge sin uso desde junio de 2025) y la
   extensión **no tiene permiso en incógnito** (`incognito` ausente en Secure Preferences; uBO Lite y ABP instalados pero
   desactivados). Hipótesis pendiente de su respuesta: ventana de incógnito u otro dispositivo. Si es incógnito, es un
   toggle suyo en `chrome://extensions` ("Permitir en modo incógnito"), no un bug; el registro `ad-shown` tampoco
   saltaría ahí. Cómo se miró: `Secure Preferences` → `extensions.settings.<id>`, `Extension Scripts/*.log` (LevelDB,
   `grep -a`), y el `History` copiado a Temp (SQLite; con Python hay que darle la ruta Windows, `/tmp/...` crea una base
   vacía y da "no such table").

0. **(Fran) Recargar la extensión en `chrome://extensions`** con el `dist/` de la 1.0.8 (`npm run build` hecho el
   2026-11-21 con la numeración por `LIVE-SEQUENCE`; `npm test`, `npm run smoke` y `npm run probe` en verde). Una
   pestaña de Twitch que ya estuviera abierta necesita además F5. Se cierra cuando el popup diga 1.0.8. Hasta entonces
   el "desync" tras cada midroll sigue.

0b. **El primer midroll real con la 1.0.8 salió bien, pero en la pestaña de Fran está por ver.** El 21 a las 13:03Z
   `npm run verify -- twitch --seconds=900` cazó uno en teshrak (720p60, pod=1, 100 s, 28/28 `swapped`, 0 `held`):
   el primer backup entró con `shift +0` y ningún `sequence back` (en la 1.0.7 ese mismo canal reiniciaba en el
   primer poll), la página se renumeró `-1 by LIVE-SEQUENCE`, 0 reinicios, 0 parones, sin UI de anuncio y el reloj
   avanzó 10,1 s en los 10 s siguientes al corte (`=> BLOCKED`). El registro del `verify` se quedó en la carpeta
   temporal de Playwright, así que no hay JSON que releer. Se cierra del todo cuando Fran, con la 1.0.8 recargada,
   pase un midroll sin ver el directo rebobinarse al acabar el anuncio; si un corte vuelve a dejar registro con
   `sequence restart`, lo primero es el log del worker en el primer poll (`backup X lists nothing past N`) y comprobar
   en sus playlists que `LIVE-SEQUENCE` sigue igualando el `MEDIA-SEQUENCE` de los backups.

1. **Verificar el recorte nuevo por encima de 8 MB** (`496fd56`, lógica sencilla pero sin ejercitar; el mayor de hoy pesó
   5,6 MB con dos cortes). Solo lo dispara una pestaña con muchos cortes: la del 2 de noviembre llevaba 17 y sin recortar
   habría rondado los 17 MB. Se cierra si en un registro así los `breakEnds` anteriores al último traen `playlists: []` con
   `playlistsTrimmed: N`, el último conserva las suyas, `worker.recent` pasa de 10 (hasta 80), `samples` llega a 900 y
   `events` no se corta en 500, y el fichero no pasa de 8 MB.

2. **El pase del anuncio y la espera a los tokens siguen sin verse en vivo** (1.0.4). El preroll del 5 (zeling) salió
   bien, pero los seis tokens llegaron 240 ms antes que la primera playlist y la cadena no necesitó ni `awaitBackupMasters`
   ni `passed`. Solo los ejercita un preroll en el que la primera playlist gane a los tokens (el 31 fue así: playlist a los
   800 ms del master, tokens después). Su registro cae siempre (`preroll` es pega). Se cierra si en uno así el player frío
   recibe la playlist con anuncio (`passed=N`, evento `adPassedThrough`) en vez de blancos, arranca en `autoplay` 360p y no
   hay negro ni reinicio por `no data`. Si vuelve a quedarse en negro, lo primero es el log del worker
   (`no backup master yet: waited N ms`).
