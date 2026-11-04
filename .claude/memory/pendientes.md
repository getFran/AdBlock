---
name: pendientes
description: Lo que quedó sin verificar o sin documentar al cerrar una sesión; se lee al abrir y se tacha al resolverse. Actualizado el 2026-11-04.
metadata:
  type: project
---

**Why:** Fran lo pidió el 2026-11-04 ("todo lo que tengas pendiente déjalo en una lista de pendientes por si cierro la
sesión sin verificar lo que pides"): él no siempre puede hacer en el momento lo que una sesión le pide (recargar la
extensión, forzar un registro), y la siguiente sesión tiene que saber qué quedó a medias sin releer el historial.

**How to apply:** leer esto al abrir sesión. Cada punto dice qué falta, cómo se comprueba y qué resultado lo cierra.
Al cerrarlo, quitarlo de aquí (si deja lección, va a su memoria o al `CLAUDE.md`) y commitear. Lo que Fran tiene que
hacer él va marcado **(Fran)**.

## Pendiente a 2026-11-04

1. **(Fran) Recargar la extensión en `chrome://extensions`.** El `dist/` se reconstruyó el 2026-11-04 con el commit
   `496fd56` (ventana de muestras por corte y recorte nuevo del registro). Hasta que recargue, los registros salen con la
   forma vieja: 300 muestras, 10 playlists del worker.

2. **Verificar la ventana de muestras por corte** (`496fd56`, sin probar en vivo). Hace falta un registro escrito
   **después** de al menos un corte limpio en la misma pestaña: o cae solo por un corte con pega (esportmaniacos los
   tiene cada 20 min y casi siempre con `held`), o lo fuerza Fran con `window.__adblockTwitch.save()` en la consola de la
   pestaña. Se cierra si en el JSON cada `breakEnds[i]` trae `samples` (≈ duración del corte + 35 entradas, de 5 s antes a
   30 s después) y `npm run records` muestra `samples=N covered=true` en los cortes limpios en vez de `samples: NONE in
   window`. En los registros hasta el 4 de noviembre inclusive, todos los cortes limpios salían `NONE in window`.

3. **Verificar el recorte nuevo por encima de 8 MB** (`496fd56`, lógica sencilla pero sin ejercitar). Solo lo dispara una
   pestaña con muchos cortes: la del 2 de noviembre llevaba 17 y sin recortar habría rondado los 17 MB. Se cierra si en un
   registro así los `breakEnds` anteriores al último traen `playlists: []` con `playlistsTrimmed: N`, el último conserva las
   suyas, `worker.recent` pasa de 10 (hasta 80), `samples` llega a 900 y `events` no se corta en 500, y el fichero no pasa
   de 8 MB. Medido ese día: `chrome.downloads` escribe 48 MB como data URL desde el service worker, así que el tope es
   por legibilidad, no por Chrome.

4. **El siguiente preroll real** (pendiente desde el 2026-10-31, 1.0.4; está en el `CLAUDE.md` como "Queda por ver en el
   siguiente preroll real"). Su registro cae siempre (`preroll` es pega). Se cierra si en él el player frío recibe la
   playlist con anuncio (`passed=N`, evento `adPassedThrough`) en vez de blancos, arranca en `autoplay` 360p en ~200 ms,
   pasa a `site` 1080p60 al acabar el pod, y no hay pantalla en negro ni hace falta el reinicio por `no data`. Si vuelve a
   quedarse en negro, lo primero es el log del worker (`awaitBackupMasters`, `no backup master yet`).

5. **Documentar los registros del 1 al 4 de noviembre** en el histórico del `CLAUDE.md` y en la memoria
   `twitch-intercambio-verificado-primer-midroll-real`. Son 31 cortes, todos a 1080p60, 0 `offQuality` y 0 reinicios: 9 el
   día 1 (reventxz ×4 limpios, esportmaniacos ×5 con `held`), 17 el día 2 (elbokeron 1, reventxz 6, pausenpaii 2, todos
   limpios; esportmaniacos 8, cuatro con `held`) y 5 el día 4 (esportmaniacos, tres con `held` de ~1,75 s). Desde el 1 de
   noviembre **todos los registros los ha disparado un `held` de esportmaniacos**; los demás canales no han dado ninguno.
   Queda por leer con `--verbose` si algún `held` costó una pausa del player (campo `paused=N` de las muestras, como el
   del 30 de octubre), y luego resumirlo en una frase en los dos sitios.
