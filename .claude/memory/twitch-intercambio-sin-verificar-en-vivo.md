---
name: twitch-intercambio-sin-verificar-en-vivo
description: El intercambio de stream de Twitch (portado de Purple el 2026-10-15) está escrito, con checks unitarios y hook en producción, pero no se ha visto actuar en vivo; esa tarde 2 h 20 min sobre 23 cargas de canales grandes no trajeron ningún corte cosido (twitch-stitched-ad): todos los midrolls fueron client-side (twitch-maf-ad cada 4-5 min, edge.ads.twitch.tv respondido vacío) y los canales offline reproducen VOD con un preroll CSAI por XHR. Cómo cazar un corte la próxima vez y qué leer en la consola.
metadata:
  type: project
---

Dos pasadas de `npm run verify -- twitch` el 2026-10-15 por la tarde (Chromium 156 de Playwright,
headless, perfil nuevo por pasada, sin login, desde España), con el bloqueo ya portado:

| Pasada | Canales | Tiempo | Cortes cosidos | CSAI respondidos vacíos | Parones ≥ 5 s | UI de anuncio |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | auronplay, ibai, illojuan, rubius, caedrel (900 s cada uno) | 75 min | 0 | 16 (`fetch`, bp=midroll) | 0 | 0 |
| 2 | 18 canales top (150 s cada uno) | 45 min | 0 | 7 (5 midroll por `fetch`; 2 preroll por XHR en canales que se habían quedado offline y pasaron a VOD) | 0 | 0 |

**Lo que sí se verificó en vivo:** el hook de página corta el CSAI (las dos rutas, `fetch` y XHR); los
seis masters de backup se piden al cargar el canal y están listos en 0,4-0,8 s; la página pide el
master `picture-by-picture` cada 8-14 min y se responde vacío sin que el player se queje; el vídeo
avanza sin parón con el hook dueño del `fetch` del worker; el DNR del Base bloquearía
`edge.ads.twitch.tv` por su cuenta (`testMatchOutcome`: `ruleset_2`).

**Lo que no:** ningún `twitch-stitched-ad`, así que la cadena de backups, la alineación de
`MEDIA-SEQUENCE`, el blank segment y el reinicio por secuencia solo tienen los checks unitarios
(`test/twitch-playlists.mjs`) y el dato de la sonda de la mañana (un PREROLL en auronplay a los 5
min, siete backups limpios). Purple documenta que los cortes cosidos aparecen en una fracción de las
cargas (7 prerolls en 89 cargas de su soak p) y que un reload del player con token nuevo los trae a
veces.

**Un bug que salió en vivo y ya está arreglado:** el player cancela peticiones (`Request cancelled`);
si el hook del worker captura ese error y reintenta, le devuelve al player una respuesta que ya no
esperaba. Los handlers lanzan la petición original ellos mismos y solo el procesado lleva try/catch.

**Why:** la próxima sesión no debe dar el intercambio por probado porque "el código está", ni
sorprenderse de que una hora de canales grandes no traiga un corte: hoy Twitch mete los midrolls
client-side y el cosido es raro desde este perfil.

**How to apply:** para cazar uno, `npm run verify -- twitch --seconds=150 --twitch=<10-20 canales>`
(muchas cargas cortas) o, si Fran ve un corte real en su Chrome, pedirle la consola filtrada por
`AdBlock/twitch`: `AD BREAK …` (el corte), `backups: site=clean@720p60 …` (qué devolvió cada tipo),
`player <- backup …` (qué se sirvió y el desplazamiento de secuencia), `AD BREAK over …` (resumen) y
`window.__adblockTwitch.breakEnds`. Si aparece `sequence back` o `video still … pause/play`, es el
reinicio: no es un fallo, pero cuesta ~1 s. Relacionado:
[[twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios]] (el dato de la mañana),
[[twitch-ningun-player-type-garantiza-stream-sin-anuncios]].
