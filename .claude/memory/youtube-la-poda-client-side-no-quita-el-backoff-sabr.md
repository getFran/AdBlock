---
name: youtube-la-poda-client-side-no-quita-el-backoff-sabr
description: Los anuncios de YouTube web siguen siendo client-side y podables (adPlacements en el ytInitialPlayerResponse inline, sonda 2026-10-15), pero el retraso de "buffering" va firmado server-side en la URL del vídeo (80 % de la duración del anuncio) y ninguna extensión lo quita; los filtros de YouTube de uAssets cambian cada ~3 días, así que no se escriben a mano.
metadata:
  type: project
  idea: bloqueador-de-anuncios-para-chrome-twitch-y-youtube
---

Sonda del 2026-10-15 desde España a `watch?v=dQw4w9WgXcQ` sin cookies: el `ytInitialPlayerResponse`
inline del HTML viene con `playabilityStatus: OK` y **`adPlacements` con un pre-roll**
(`AD_PLACEMENT_KIND_START`); `streamingData` ya trae `serverAbrStreamingUrl` (SABR). El mismo vídeo
pedido a `/youtubei/v1/player` desde fuera del navegador da `UNPLAYABLE` (exige PoToken), lo que no
afecta a una extensión porque BotGuard corre en la página. El SSAI (anuncio cosido en el stream) sigue
siendo un experimento sin cifra oficial (AdGuard, 2026-08-13).

Lo que sí está generalizado es la penalización: InnerTube firma en la URL de `/videoplayback` un backoff
del **80 % de la duración del anuncio** (15 s de anuncio = 12 s de "buffering") que se aplica tenga o no
bloqueador quien esté en el grupo de prueba; podar el anuncio no quita el retraso (iter.ca, 2025-06-20;
megahilo uAssets #30157). Contramedidas activas en los filtros del 2026-10-15: iframe `about:blank`
para obtener un `fetch` virgen, `onAbnormalityDetected`, temporizador de 17 s, `attestationRequest`.
Cadencia: **14 commits a `quick-fixes.txt` entre 2026-09-07 y 2026-10-15**. uBO Lite lo bloquea en modo
*Optimal* con scriptlets empaquetados; cada rotura espera a la siguiente release (cada 5-6 días).

**Why:** marca el techo de lo que una extensión puede conseguir en YouTube (sin anuncio, pero quizá con
retraso) y descarta escribir las reglas a mano: a tres días por cambio, lo único sostenible es consumir
los argumentos de uAssets o los scriptlets de `@adguard/scriptlets` en el build.

**How to apply:** parchear `fetch`/`XMLHttpRequest`/`JSON.parse` en MAIN world a `document_start` para
podar `adPlacements`, `adSlots` y `playerAds` (también en el inline), con los argumentos leídos de
`uAssets/filters/quick-fixes.txt` en build; y avisar de que el "buffering" de 4-24 s, si aparece, es el
A/B de YouTube y no un fallo propio. Relacionado: [[mv3-main-world-document-start-se-inyecta-al-insertar-html]].
