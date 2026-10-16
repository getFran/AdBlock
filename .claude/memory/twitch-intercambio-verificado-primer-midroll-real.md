---
name: twitch-intercambio-verificado-primer-midroll-real
description: Primer corte cosido real con el intercambio de stream activo en el Chrome de Fran (2026-10-16 13:51, pausenpaii, MIDROLL de 45 s, 25 polls con anuncio): los 25 se sirvieron con la playlist de un backup limpio a 1080p60, sin merge ni blank, el vídeo no se paró ni un segundo y no salió la UI de anuncio. Los backups anuncian su propio corte cada 2-4 s y la cadena rota site→popout→frontpage→mobile_web sin perder calidad. Hasta la tarde anterior no había salido ningún corte en 2 h 20 min de pruebas.
metadata:
  type: project
---

Registro automático `C:\Users\javie\Downloads\AdBlock\twitch-2026-10-16T11-52-11-438Z-break.json` (424 KB,
motivo `break`, escrito 20 s después del corte), leído el 2026-10-16. Canal `pausenpaii`, player a
1080p60, extensión 0.1.0 con el popup y el interruptor por sitio ya puestos.

**El corte:** `twitch-stitched-ad` MIDROLL, pod 1, anunciado dos polls antes (11:51:03 y :04 UTC, solo
las dos líneas prefetch al anuncio quitadas y sus URIs listadas en blanco; el player nunca las pidió:
`blankAnswered=0`). Primer poll con segmentos de anuncio a las 11:51:06 (3/17), último a las 11:51:49
(hasta 8/23 en la playlist de la página), fin a las 11:51:51: 45 s.

**La cadena:** 25 polls con anuncio, 25 `swapped`, 0 `merged`, 0 `blanked`. El primer backup (`site`,
pin) llegó 0,4 s después del primer poll. Cada tipo aguanta 2-4 s limpio y luego su playlist viene con
el corte anunciado (`announced`, el B-036 de Purple), se descarta 5 s, se pide token nuevo (listo en
0,3 s) y entra el siguiente: `site → popout → frontpage → site → popout → frontpage → site → popout →
frontpage → mobile_web → site → …`, siempre a 1080p60; `embed` y `autoplay` quedaron de reserva.
Desplazamiento de `MEDIA-SEQUENCE` 0 en todos (misma base que la página). Ninguna playlist
entregada al player llevaba segmentos de anuncio.

**El vídeo:** muestras de 1/s desde 5 s antes hasta 30 s después: ningún parón de 2 s o más, nunca
`paused`, `readyState` nunca por debajo de 3, `currentTime` 408,3 → 454,3 al acabar → 473,4 a los
30 s. UI de anuncio de Twitch: 0 muestras. Reinicios (pause/play, reload): 0. CSAI respondidos
vacíos en la sesión: 2 (midroll), de ventanas `twitch-maf-ad` anteriores.

**Why:** es la primera evidencia de que la implementación portada de Purple funciona de punta a punta
en el navegador real de Fran, no solo en los checks unitarios; y confirma que el orden decidido
(site, popout, frontpage, mobile_web, embed, autoplay) mantiene la calidad del player durante todo el
corte aunque cada backup se contamine a los pocos segundos.

**How to apply:** una muestra, no una estadística: queda por ver un PREROLL de carga (donde Purple
dice que los backups traen su propio preroll y entra `autoplay` a 360p), un corte con el player a
720p60 o 480p, y una sesión larga con varios cortes. Si Fran dice que vio un anuncio pese a esto,
buscar en el registro `merged`/`blanked` distintos de 0, `blankAnswered`, un `sequence back` o
`video still` en el log, o muestras con `adUi`. Relacionado:
[[twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios]] (la sonda que lo decidió),
[[twitch-ningun-player-type-garantiza-stream-sin-anuncios]].
