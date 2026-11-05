---
name: pendientes
description: Lo que quedó sin verificar o sin documentar al cerrar una sesión; se lee al abrir y se tacha al resolverse. Actualizado el 2026-11-05 a mediodía.
metadata:
  type: project
---

**Why:** Fran lo pidió el 2026-11-04 ("todo lo que tengas pendiente déjalo en una lista de pendientes por si cierro la
sesión sin verificar lo que pides"): él no siempre puede hacer en el momento lo que una sesión le pide (recargar la
extensión, forzar un registro), y la siguiente sesión tiene que saber qué quedó a medias sin releer el historial.

**How to apply:** leer esto al abrir sesión. Cada punto dice qué falta, cómo se comprueba y qué resultado lo cierra.
Al cerrarlo, quitarlo de aquí (si deja lección, va a su memoria o al `CLAUDE.md`) y commitear. Lo que Fran tiene que
hacer él va marcado **(Fran)**.

## Pendiente a 2026-11-05 (mediodía)

Cerrados hoy: la extensión corre el build de `1f9ae0a` (los registros de zeling desde las 09:30Z traen `player` en los
backups y `(cut at the save)` en el último corte) y la ventana de muestras por corte está verificada (los cortes limpios
de un registro posterior traen duración + 35 muestras). El cambio de `covered` en `test/twitch-records.mjs` no toca
`dist/`: no hace falta recargar nada.

1. **Verificar el recorte nuevo por encima de 8 MB** (`496fd56`, lógica sencilla pero sin ejercitar; el mayor de hoy pesó
   5,6 MB con dos cortes). Solo lo dispara una pestaña con muchos cortes: la del 2 de noviembre llevaba 17 y sin recortar
   habría rondado los 17 MB. Se cierra si en un registro así los `breakEnds` anteriores al último traen `playlists: []` con
   `playlistsTrimmed: N`, el último conserva las suyas, `worker.recent` pasa de 10 (hasta 80), `samples` llega a 900 y
   `events` no se corta en 500, y el fichero no pasa de 8 MB.

2. **El pase del anuncio y la espera a los tokens siguen sin verse en vivo** (1.0.4). El preroll del 5 (zeling) salió
   bien, pero los seis tokens llegaron 240 ms antes que la primera playlist y la cadena no necesitó ni `awaitBackupMasters`
   ni `passed`. Solo los ejercita un preroll en el que la primera playlist gane a los tokens (el 31 fue así: playlist a los
   800 ms del master, tokens después). Su registro cae siempre (`preroll` es pega). Se cierra si en uno así el player frío
   recibe la playlist con anuncio (`passed=N`, evento `adPassedThrough`) en vez de blancos, arranca en `autoplay` 360p y no
   hay negro ni reinicio por `no data`. Si vuelve a quedarse en negro, lo primero es el log del worker
   (`no backup master yet: waited N ms`).
