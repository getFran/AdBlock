---
name: pendientes
description: Lo que quedó sin verificar o sin documentar al cerrar una sesión; se lee al abrir y se tacha al resolverse. Actualizado el 2026-11-05.
metadata:
  type: project
---

**Why:** Fran lo pidió el 2026-11-04 ("todo lo que tengas pendiente déjalo en una lista de pendientes por si cierro la
sesión sin verificar lo que pides"): él no siempre puede hacer en el momento lo que una sesión le pide (recargar la
extensión, forzar un registro), y la siguiente sesión tiene que saber qué quedó a medias sin releer el historial.

**How to apply:** leer esto al abrir sesión. Cada punto dice qué falta, cómo se comprueba y qué resultado lo cierra.
Al cerrarlo, quitarlo de aquí (si deja lección, va a su memoria o al `CLAUDE.md`) y commitear. Lo que Fran tiene que
hacer él va marcado **(Fran)**.

## Pendiente a 2026-11-05

1. **(Fran) F5 en la pestaña de Twitch que tuviera abierta.** La extensión se recargó el 2026-11-05 por la mañana con el
   `dist/` del commit `1f9ae0a` (`player` en cada entrada de `backups` del corte y `samples` del corte cortadas al guardar).
   Al recargar una extensión sin empaquetar `onInstalled` llega con `reason: update` y el service worker solo recarga las
   pestañas en `install`: una pestaña abierta de antes sigue con el `page.js` viejo. Lo demuestra un registro cuyo último
   `breakEnds[]` traiga `samplesPartial: true` o cuyas entradas de `backups` traigan `player`. (Resuelto el punto del día
   4: el registro del 5 ya salió con el build del `496fd56`, se ve en que pasa de los 1,2 MB del tope viejo.)

2. **Verificar la ventana de muestras por corte** (`496fd56`, sin verla aún en un registro). Hace falta un registro escrito
   **después** de al menos un corte limpio en la misma pestaña: o cae solo por un corte con pega (esportmaniacos los tiene
   cada 20 min y casi siempre con `held`), o lo fuerza Fran con `window.__adblockTwitch.save()` en la consola de la pestaña.
   Se cierra si en el JSON cada `breakEnds[i]` anterior al último trae `samples` (≈ duración del corte + 35 entradas, de 5 s
   antes a 30 s después, sin `samplesPartial`) y `npm run records` muestra `samples=N covered=true` en los cortes limpios en
   vez de `samples: NONE in window`. El último corte del registro sale desde el 5 con `(cut at the save)`, y eso es lo
   esperado.

3. **Verificar el recorte nuevo por encima de 8 MB** (`496fd56`, lógica sencilla pero sin ejercitar; el del 5 pesó 3,2 MB
   con un solo corte). Solo lo dispara una pestaña con muchos cortes: la del 2 de noviembre llevaba 17 y sin recortar
   habría rondado los 17 MB. Se cierra si en un registro así los `breakEnds` anteriores al último traen `playlists: []` con
   `playlistsTrimmed: N`, el último conserva las suyas, `worker.recent` pasa de 10 (hasta 80), `samples` llega a 900 y
   `events` no se corta en 500, y el fichero no pasa de 8 MB.

4. **El pase del anuncio y la espera a los tokens siguen sin verse en vivo** (1.0.4). El preroll del 5 (zeling) salió
   bien, pero los seis tokens llegaron 240 ms antes que la primera playlist y la cadena no necesitó ni `awaitBackupMasters`
   ni `passed`. Solo los ejercita un preroll en el que la primera playlist gane a los tokens (el 31 fue así: playlist a los
   800 ms del master, tokens después). Su registro cae siempre (`preroll` es pega). Se cierra si en uno así el player frío
   recibe la playlist con anuncio (`passed=N`, evento `adPassedThrough`) en vez de blancos, arranca en `autoplay` 360p y no
   hay negro ni reinicio por `no data`. Si vuelve a quedarse en negro, lo primero es el log del worker
   (`no backup master yet: waited N ms`).
