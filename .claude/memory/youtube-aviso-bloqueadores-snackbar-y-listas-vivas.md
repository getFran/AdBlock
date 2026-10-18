---
name: youtube-aviso-bloqueadores-snackbar-y-listas-vivas
description: El aviso "los bloqueadores de anuncios no están permitidos / ¿tienes interrupciones?" de YouTube (octubre de 2026) es un snackbar abajo a la izquierda, no un bloqueo; la regla de AdGuard reescribe cada /player (params=eAFgAQ, comprobado 2026-10-18) y el servidor no manda anuncios; lo ocultan dos reglas cosméticas de uBO que AdGuard no tiene; el paquete npm de AdGuard va semanas por detrás de su lista viva y por eso npm run vendor la trae.
metadata:
  type: project
  idea: bloqueador-de-anuncios-para-chrome-twitch-y-youtube
---

Fran vio el aviso el 2026-10-18. Diagnóstico de esa sesión:

- **Qué es.** El snackbar de abajo a la izquierda ("¿Tienes interrupciones? Los bloqueadores de
  anuncios infringen las Condiciones del Servicio de YouTube", con botones). Volvió a salir "en cada
  vídeo" desde el 2026-10-13 (hilo uAssets #30157); uBO lo tapó el 10-15 añadiendo
  `www.youtube.com##.ytSnackbarContainerOpened:has(> .snackbarViewModelSwipeable > …)` a
  `quick-fixes.txt`, junto al `#toast:has(… yt-notification-action-renderer)` que ya tenían. **Ninguna
  lista de AdGuard que empaquetamos (2, 3, 9, 17, 18, 19, 21, 22) lo oculta**, ni la Base viva.
- **No bloquea el player.** La regla de AdGuard `(()=>{const e=["param_first","param_second","pyv",
  "client_screen","ad_type"]…` proxya `JSON.stringify`, `TextEncoder.prototype.encode` y `Request`, y
  desde la primera petición manda `/youtubei/v1/player` con `params: "eAFgAQ"`, `lactMilliseconds`
  fresco, `visibilityState` forzado a visible y sin `appInstallData`; el servidor responde **sin
  `adPlacements`, `adSlots` ni `playerAds`** (solo el `ytInitialPlayerResponse` inline del HTML los
  trae, y los quita `set-constant`). Si aun así llega `UNPLAYABLE`/pantalla de error, su gemela (la del
  observer del DOM, hook de `XMLHttpRequest.send`) rota `8AUB` → `pyv` → `clientScreen: CHANNEL` →
  `AD_TYPE_INSTREAM` y recarga con `loadVideoById`.
- **Cómo se comprobó.** YouTube manda el cuerpo de `/player` como `Uint8Array` (flags
  `all_web_network_machine_raw_request=true`): Playwright devuelve `postData()` nulo. Lo que funciona es
  `context.addInitScript` envolviendo `TextEncoder.prototype.encode` antes de que corra la extensión
  (se queda por debajo de los proxies de AdGuard y ve el cuerpo ya reescrito). `Function.prototype.toString`
  de un Proxy dice `[native code]`: no vale para saber si algo está hookeado.
- **No se reproduce con perfil nuevo**: solo sale en cuentas/sesiones marcadas. Seis vídeos seguidos
  (cargas completas y navegación SPA) sin sesión: cero avisos, cero pantallas de error.
- **El paquete npm va por detrás.** `@adguard/dnr-rulesets` 5.0.20261013 salió 36 días después del
  anterior; en ese mismo mes AdGuard hizo 8 commits a las reglas de YouTube. La lista viva
  (`filters.adtidy.org/extension/chromium-mv3/filters/2.txt`) se actualiza cada hora.

**Why:** sin esto, la próxima vez que YouTube cambie algo la reacción natural sería "actualizar listas"
con `npm install @latest`, y no habría nada que instalar. Y porque el aviso parece un bloqueo y no lo es:
lo que hay que mirar primero es si el vídeo reproduce, no el mensaje.

**How to apply:** si Fran ve un aviso de YouTube, preguntar/comprobar si el vídeo sigue; si sigue, es
el snackbar: `npm run vendor && npm run build` y recargar la extensión (trae la Base viva de AdGuard y
el quick-fixes de uBO de hoy). Si el vídeo no reproduce, mirar en consola `[AdBlock/youtube]` (reglas
fallidas) y el `/player` con el hook de `TextEncoder` de arriba. El "buffering" de unos segundos al
arrancar es otra cosa y nadie lo quita: [[youtube-la-poda-client-side-no-quita-el-backoff-sabr]].
Relacionado: [[mv3-main-world-document-start-se-inyecta-al-insertar-html]].
