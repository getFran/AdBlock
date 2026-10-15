---
name: twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios
description: Dato de la sonda de Twitch del 2026-10-15 (hook de Worker y fetch portado de Purple, Chromium de Playwright, perfil nuevo, sin login, desde España): en un corte cosido real (twitch-stitched-ad PREROLL en auronplay, 4/4 segmentos de anuncio) los siete player_type de respaldo pedidos en paralelo con las cabeceras GQL de la página devolvieron stream limpio, cinco de ellos a la misma calidad (720p60), aunque todos los tokens traían show_ads:true; un solo corte, pero resuelve la incógnita del croquis a favor del intercambio de stream.
metadata:
  type: project
---

Dos pasadas el 2026-10-15 con `npm run verify -- twitch` (Chromium 156 de Playwright, headless,
perfil nuevo, sin login, desde España): 300 s sobre `caedrel` (sin corte cosido) y 600 s sobre
`auronplay` (un corte cosido a los 300 s).

**Lo comprobado:**

- El content script MAIN a `document_start` llega antes de que el player cree sus workers: los dos
  (`blob:` de 98 bytes, un `importScripts`) pasaron por el hook y el código prepended arrancó en
  ambos. Igual que Purple en su finding de 2026-10-07.
- Dentro del worker se ven el master de usher (`player_type=site`, `show_ads=true`,
  `server_ads=true`, `hide_ads=false`) y las media playlists, una cada ~2 s con 14 segmentos.
- La página captura las cabeceras GQL que hacen falta para los tokens de respaldo: `X-Device-Id`,
  `Authorization` (no vacía aunque no haya login), `Client-Version`, `Client-Session-Id` y, desde el
  primer `/integrity`, `Client-Integrity`.
- Clases de `#EXT-X-DATERANGE`: `timestamp`, `twitch-session`, `twitch-stream-source`,
  `twitch-trigger` (siempre); `twitch-maf-ad` a los 2-4 min en los dos canales (marcador del
  anuncio **client-side**, CSAI; duró ~2 min y en esta sesión no se vio petición a
  `edge.ads.twitch.tv`); y en `auronplay`, **`twitch-stitched-ad` + `twitch-ad-quartile`** con
  `ROLL-TYPE=PREROLL`, `POD-LENGTH=1`: la playlist del player pasó a tener 4 segmentos, los 4 de
  anuncio.
- **La sonda de backups, en ese momento y en 1,9 s** (los siete tokens y masters en paralelo, GQL
  ejecutado por la página con sus cabeceras, usher con los parámetros del propio player):
  `embed`, `popout`, `frontpage`, `mobile_web` y `site` → playlist limpia a **720p60** (la misma
  calidad que el player), 0/14 segmentos de anuncio, sin marcador cosido; `autoplay` (platform
  `android`) y `picture-by-picture` → limpios pero a **360p30**. Los siete tokens traían
  `show_ads:true`, `server_ads:true`, `hide_ads:false`: el flag no predice si la playlist trae el
  anuncio.
- Los rulesets genéricos no rompen Twitch: las coincidencias DNR sobre `irc-ws.chat.twitch.tv` y
  `hermes.twitch.tv` son reglas `allow` del Base (websocket); lo bloqueado fue `spade.twitch.tv`,
  `amazon-adsystem` y `player.stats.live-video.net`.

**Why:** la incógnita crítica del croquis era si hoy, desde España, algún `player_type` de respaldo
sigue dando stream limpio durante el corte o solo la placa "commercial break". Con un corte real la
respuesta es que sí, y a plena calidad; esto es lo que decide que el bloqueo de Twitch sea un
intercambio de stream (lo que hace Purple) y no un recorte de segmentos. Es **una** muestra: Purple
documenta que durante un pre-roll los backups pedidos a mitad del corte a veces traen su propio
pre-roll (17 de 17 cargas en sus soaks) y que en mid-rolls casi nunca; aquí el corte etiquetado
PREROLL llegó a los 5 min y los backups salieron limpios.

**How to apply:** en la siguiente sesión, portar el intercambio de Purple: al ver
`twitch-stitched-ad`, servir al player la playlist del backup limpio de su misma calidad (orden
`site`, `popout`, `frontpage`, `mobile_web`, `embed`, y `autoplay` como último recurso a 360p),
fijando el tipo que funcionó y descartando por 5 s el que venga con anuncio; y responder vacío a
`edge.ads.twitch.tv` para el CSAI de `twitch-maf-ad`. Para más muestras:
`npm run verify -- twitch --seconds=1800 --twitch=<canal>` deja el JSON en `.cache/twitch-probe-*.json`.
Relacionado: [[twitch-ningun-player-type-garantiza-stream-sin-anuncios]] (los flags del token),
[[mv3-main-world-document-start-se-inyecta-al-insertar-html]].
