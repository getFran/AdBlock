---
name: youtube-popup-enforcement-y-listas-vivas
description: El popup "Ad blockers are not allowed on YouTube" (ytd-enforcement-message-view-model) que Fran vio el 2026-10-18 solo sale en cuentas marcadas y no se reproduce con perfil nuevo; el player lo dispara con onAbnormalityDetected (slot de preroll sin reproducir, o el stream SABR avisando de anuncios que la respuesta podada no trae) y la carga viaja en auxiliaryUi.messageRenderers.enforcementMessageViewModel; ninguna lista la poda hoy (cuatro reglas locales lo hacen), la evidencia es el registro youtube-*.json de Descargas\AdBlock\, y el paquete npm de AdGuard va semanas por detrás de su lista viva.
metadata:
  type: project
  idea: bloqueador-de-anuncios-para-chrome-twitch-y-youtube
---

Sesión del 2026-10-18. Fran enseñó el modal clásico: "Ad blockers are not allowed on YouTube", "Allow
YouTube Ads" / "Try YouTube Premium", "Not using an ad blocker? Report issue". No era el snackbar
"¿Tienes interrupciones?" (ese también existe esta temporada y lo tapan dos reglas cosméticas de uBO
que el build toma de `quick-fixes.txt`).

- **Cómo se dispara (base.js del 2026-10-18, `player_es6`).** El player emite `onAbnormalityDetected`
  en tres sitios: al pulsar "saltar anuncio" si una comprobación falla; cuando un slot de preroll
  (`metadata_type_player_bytes_slot_metadata`, `isPreroll`) no llegó a reproducirse (`NKDSTAT 0`); y,
  con `html5_enable_t1_enf_on_sabr`, cuando llega por el stream SABR un context update de tipo 5 y
  `yKF(playerResponse)` dice que la respuesta del cliente no trae anuncios (`MBSTAT 0`): **el servidor
  le cuenta al player que tocaban anuncios y el player comprueba su propia copia, o sea, detecta la
  poda**. La app (bundle `ytmainappweb`, módulos que no son `m=base`) escucha ese evento y abre el popup
  con `auxiliaryUi.messageRenderers.enforcementMessageViewModel`, que viene en cada player response de
  una cuenta marcada; su botón "Allow YouTube Ads" abre un `allowAdsPopup` con instrucciones
  (`fundingChoiceInstructionPageUrl`).
- **Qué hacen los grandes.** AdGuard Base y uBO anulan el manejador con un proxy de
  `Promise.prototype.then` que sustituye por un no-op el callback cuyo `toString()` contiene
  `onAbnormalityDetected` (nuestra primera regla JS del Base). Ninguno poda ya la carga del popup:
  `enforcementMessageViewModel`/`auxiliaryUi` no aparecen en el Base vivo, en los otros siete rulesets
  que empaquetamos ni en ningún fichero de uAssets (solo una línea comentada en Other Annoyances para
  `upsellDialogRenderer`). Por eso van como **reglas locales** (`build.config.mjs` → `youtube.local`,
  sintaxis AdGuard, mismo pipeline): `set-constant` del inline, `json-prune`, `json-prune-fetch-response`
  y `json-prune-xhr-response` con los `propsToMatch` del propio Base. Descartado ocultar el diálogo por
  CSS: un `tp-yt-paper-dialog` con backdrop escondido deja el scroll de la página bloqueado.
- **Por qué no se verifica en Playwright.** Solo sale en cuentas o sesiones marcadas: seis vídeos
  seguidos sin sesión (cargas completas y SPA) dieron cero popups y cero pantallas de error. La
  evidencia real es `src/youtube/record.js`: guarda los últimos 20 `/player` y `/next` tal como los
  manda el servidor (hooks en `Response.prototype.json/text` y XHR instalados antes que las reglas, así
  ven los bytes sin podar), vigila `ytd-enforcement-message-view-model` y la pantalla de error, y escribe
  `Descargas\AdBlock\youtube-<fecha>-<motivo>.json` por `bridge.js`. `window.__adblockYoutube.save()` a
  mano. `verify youtube` pide uno y lo lee.
- **Cómo mirar el cuerpo de `/player`.** YouTube lo manda como `Uint8Array`
  (`all_web_network_machine_raw_request=true`): Playwright devuelve `postData()` nulo. Lo que funciona es
  `context.addInitScript` envolviendo `TextEncoder.prototype.encode` antes de que corra la extensión; así
  se vio que la regla de AdGuard mete `params=eAFgAQ` y que el servidor responde sin `adPlacements`.
  `Function.prototype.toString` de un Proxy dice `[native code]`: no sirve para saber si algo está hookeado.
- **El paquete npm va por detrás.** `@adguard/dnr-rulesets` 5.0.20261013 salió 36 días después del
  anterior; en ese mes AdGuard tocó YouTube ocho veces. La lista viva
  (`filters.adtidy.org/extension/chromium-mv3/filters/2.txt`) se actualiza cada hora y `npm run vendor`
  la trae a `vendor/adguard-base-youtube.txt`.

**Why:** el popup parece un fallo del bloqueo y es una decisión del servidor sobre la cuenta más una
detección del player; sin el registro, la única fuente sería la consola, y Fran no copia nada de ahí.
Y porque la reacción natural, `npm install @latest`, no trae nada durante semanas.

**How to apply:** si Fran ve el popup, pedirle la hora y leer el `youtube-*.json` más cercano de
`C:\Users\javie\Downloads\AdBlock\`: si algún `/player` trae `auxiliaryUi` con
`enforcementMessageViewModel`, la poda local no llegó a ese camino (mirar `via`); si no lo trae y el
popup salió igual, el disparo viene de otro sitio y hay que mirar `events` y `log`. Para una rotura de
YouTube en general: `npm run vendor && npm run build` y recargar. El "buffering" de unos segundos al
arrancar es otra cosa y nadie lo quita: [[youtube-la-poda-client-side-no-quita-el-backoff-sabr]].
Relacionado: [[mv3-main-world-document-start-se-inyecta-al-insertar-html]].
