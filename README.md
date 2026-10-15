# AdBlock — bloqueador de anuncios para Chrome (Twitch y YouTube)

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
npm run build` y recargar la extensión.

Verificación en páginas reales (Chromium de Playwright, perfil nuevo cada vez):

```
npm run verify -- generic      # marca.com, elmundo.es, as.com: peticiones bloqueadas + hojas cosméticas
npm run verify -- youtube      # player response sin adPlacements, 25 s sin UI de anuncio, navegación interna
npm run verify -- twitch --seconds=900 --twitch=auronplay,ibai   # vigila canales hasta cazar un corte cosido y lo evalúa
node test/twitch-playlists.mjs                                   # piezas puras del worker, sin navegador
```

## Estado (2026-10-15)

- Genérico y YouTube: funcionando y verificados.
- Twitch: bloqueo por intercambio de stream (site → popout → frontpage → mobile_web → embed → autoplay
  360p), blank segment para lo que ningún backup cubra, y `edge.ads.twitch.tv` respondido vacío. Un
  corte cosido solo se verifica cuando Twitch lo mete: si la prueba no ve ninguno, lo dice. **El
  intercambio aún no se ha visto en vivo** (2026-10-15: 2 h 20 min y 23 cargas sin corte cosido); el
  bloqueo del anuncio client-side sí (23 peticiones respondidas vacías, sin UI de anuncio ni parones).

Cuando salte un anuncio con la extensión cargada: consola de la pestaña (F12), filtrar por
`AdBlock/twitch`. Las líneas `AD BREAK`, `backups:`, `player <- backup ...` y `AD BREAK over` cuentan
qué se sirvió; `window.__adblockTwitch.breakEnds` tiene el resumen por corte.

> Repo privado y debe seguir siéndolo.
