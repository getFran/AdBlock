# AdBlock — bloqueador de anuncios para Chrome (Twitch y YouTube)

Extensión de Chrome (Manifest V3) que bloquea anuncios en cualquier web con las listas de AdGuard y
trata aparte YouTube (poda del player response) y Twitch (hook del worker del player). Es una
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
npm run verify -- twitch       # sonda: clases DATERANGE y, si hay corte, qué player_type llega limpio
```

## Estado (2026-10-15)

- Genérico y YouTube: funcionando y verificados.
- Twitch: solo la sonda. El bloqueo se decide con el dato que dé (`CLAUDE.md`, sección Twitch).

> Repo privado y debe seguir siéndolo.
