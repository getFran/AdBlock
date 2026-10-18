# getFran AdBlock — bloqueador de anuncios para Chrome (Twitch y YouTube)

Extensión de Chrome (Manifest V3) que bloquea anuncios en cualquier web con las listas de AdGuard y
trata aparte YouTube (poda del player response) y Twitch (intercambio de stream en el worker del
player, portado de Purple Ads Blocker). Es una
**carcasa**: los rulesets, los scriptlets y los argumentos vienen de piezas que mantienen otros
(`@adguard/dnr-rulesets`, `@adguard/scriptlets`, uAssets, Purple Ads Blocker) y una rotura se
arregla con un build, no investigando. Solo para el Chrome de Fran, cargada descomprimida.

Croquis y motivación: `ProjectKit/ideas/bloqueador-de-anuncios-para-chrome-twitch-y-youtube.md`.

## Uso

```
npm install
npm run build        # -> dist/
```

En `chrome://extensions`: modo desarrollador → "Load unpacked" → la carpeta `dist/`. Actualizar
listas = `npm install @adguard/dnr-rulesets@latest @adguard/scriptlets@latest && npm run vendor &&
npm run build` y recargar la extensión. Si lo que falla es YouTube, `npm run vendor && npm run build`
basta: las reglas de YouTube de AdGuard se toman de su lista viva (`vendor/adguard-base-youtube.txt`),
no del paquete npm, que va semanas por detrás.

Verificación en páginas reales (Chromium de Playwright, perfil nuevo cada vez):

```
npm run verify -- generic      # marca.com, elmundo.es, as.com: peticiones bloqueadas + hojas cosméticas
npm run verify -- youtube      # player response sin adPlacements, 25 s sin UI de anuncio, navegación interna
npm run verify -- twitch --seconds=900 --twitch=auronplay,ibai   # vigila canales hasta cazar un corte cosido y lo evalúa
node test/twitch-playlists.mjs                                   # piezas puras del worker, sin navegador
```

## Desactivar en un sitio

Icono del perro en la barra → "Desactivar en <host>". Quita en ese host y sus subdominios los bloqueos
de red, el CSS cosmético y los scripts de YouTube y Twitch, y recarga la pestaña. `getfran.dev` viene
desactivado de fábrica porque una regla de AdGuard (`||umami.`) rompe el panel de Umami autoalojado.

## Estado (2026-10-18)

- Genérico y YouTube: funcionando y verificados. El popup "Ad blockers are not allowed on YouTube"
  (2026-10-18) solo sale en cuentas marcadas y no se reproduce con perfil nuevo: desde ese día cuatro
  reglas locales podan su carga (`auxiliaryUi.messageRenderers.enforcementMessageViewModel`) además de la
  regla de AdGuard que anula la detección, y la extensión deja un `Descargas\AdBlock\youtube-<fecha>-
  <motivo>.json` cuando aparece el popup o la pantalla de error, con los player responses tal como
  llegaron. El snackbar "¿Tienes interrupciones?" lo tapan dos reglas de uBlock Origin que entran al
  build, y las reglas de YouTube de AdGuard se refrescan con `npm run vendor` desde la lista viva.
- Twitch: bloqueo por intercambio de stream (site → popout → frontpage → mobile_web → embed → autoplay
  360p), blank segment para lo que ningún backup cubra, y `edge.ads.twitch.tv` respondido vacío. Un
  corte cosido solo se verifica cuando Twitch lo mete: si la prueba no ve ninguno, lo dice. Primer
  midroll real el 2026-10-16 (pausenpaii, 45 s): playlists limpias (25/25 polls con backup a 1080p60)
  pero la imagen se quedó congelada hasta un F5 con el audio siguiendo; desde entonces el guardián de la
  página reinicia el player cuando los fotogramas dejan de pintarse. El anuncio client-side se corta
  desde el primer día.

Cuando salte un anuncio con la extensión cargada no hay que copiar nada: la extensión deja sola un
`Descargas\AdBlock\twitch-<fecha>-<motivo>.json` (tras cada corte cosido y cuando la UI de anuncio de
Twitch se queda visible; a mano, `window.__adblockTwitch.save()` en la consola). Basta decir la hora
para que la siguiente sesión lo lea. Dentro van las muestras del vídeo, el log, los eventos y las
últimas playlists del player y de los backups.

> Repo privado y debe seguir siéndolo.
