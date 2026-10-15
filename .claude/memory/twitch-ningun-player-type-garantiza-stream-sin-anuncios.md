---
name: twitch-ningun-player-type-garantiza-stream-sin-anuncios
description: En Twitch el token de reproducción trae show_ads:true y server_ads:true para site, embed y picture-by-picture (sonda 2026-10-15), así que el truco del player embebido "sin anuncios" ya no está garantizado; y una petición HLS a pelo no dispara el pre-roll, por lo que el marcador twitch-stitched-ad solo se captura desde el navegador real.
metadata:
  type: project
  idea: bloqueador-de-anuncios-para-chrome-twitch-y-youtube
---

Sonda del 2026-10-15 desde España (GQL `PlaybackAccessToken` con el client-id público de la web +
usher + primera media playlist) sobre `caedrel` y otros diez canales en directo: el token devuelto para
`player_type` `site`, `embed` y `picture-by-picture` lleva **`show_ads: true`, `server_ads: true`,
`hide_ads: false`** en los tres casos (`picture-by-picture` además solo da dos variantes, a baja calidad).
En **11 sesiones anónimas nuevas** (X-Device-Id aleatorio) ninguna playlist traía un `#EXT-X-DATERANGE`
de anuncio: solo las clases `timestamp`, `twitch-session`, `twitch-stream-source` (= `live`) y
`twitch-trigger`. El pre-roll lo dispara algo que el player envía y una petición a pelo no.

El marcador real, confirmado en código vivo (streamlink `twitch.py`, vaft 37.0.0, TTV LOL PRO
`getFetch.ts`), es `CLASS="twitch-stitched-ad"` con `X-TV-TWITCH-AD-ROLL-TYPE` PREROLL/MIDROLL. En
nov-2025 `embed` devolvía la placa "Commercial break in progress" en vez de stream limpio
(TwitchAdSolutions #461), y ese repo, la referencia de todos, **se archivó el 2026-03-05**. Las MV3 vivas
son Purple Ads Blocker (intercambio de stream, push 2026-10-10) y TTV LOL PRO v2 (proxy, v2.6.2).

**Why:** la primera idea al diseñar el bloqueo de Twitch es "pide el stream con `player_type=embed`,
que no tiene anuncios", y los datos dicen que eso dejó de ser cierto; y la segunda es "lo pruebo con un
script", que no sirve porque el anuncio no aparece fuera del player.

**How to apply:** no asumir ningún backup limpio: detectar `twitch-stitched-ad` y probar varios
`player_type` en paralelo cuando aparezca, con la placa o el stream a 360p como peor caso. Para
verificarlo hace falta una extensión mínima dentro del Chrome real que registre lo que ve el worker, no
una sonda externa. Portar el hook del Worker de Purple en vez de reconstruirlo desde vaft.
Relacionado: [[mv3-main-world-document-start-se-inyecta-al-insertar-html]].
