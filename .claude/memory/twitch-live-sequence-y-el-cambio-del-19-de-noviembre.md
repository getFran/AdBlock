---
name: twitch-live-sequence-y-el-cambio-del-19-de-noviembre
description: El 2026-11-19 Twitch cambió la playlist del anuncio cosido (lista el pod entero y el contenido en directo con fechas adelantadas y números que siguen al pod); alineando por PROGRAM-DATE-TIME la página volvía 26-52 s por detrás (el "desync" que Fran notó) y los backups del siguiente corte salían 6-25 números atrás (reinicio F-24). Desde la 1.0.8 todo se numera con EXT-X-TWITCH-LIVE-SEQUENCE, que es la cuenta real del directo e igual en todos los tokens.
metadata:
  type: project
---

**Qué pasó.** Fran, 2026-11-21: *"últimamente hay mucho desync del directo de vez en cuando, no sé si ocurre por el
adblock y si es cuando debería saltar un anuncio"*. Sí era el adblock y sí era en los anuncios. Los registros desde el
19 (42 midrolls, 1.0.7) estaban limpios en todo lo que medíamos (0 `offQuality`, 0 parones, 0 UI de anuncio) y aun así:

- **En el primer poll de 16 de esos 42 midrolls el worker reinició el player** (`sequenceRestart`, `t` a 0 en las
  muestras): todos los backups "listaban nada" por detrás de lo entregado, de 6 a 25 números. Ni `breakFlaws` ni
  `npm run records` contaban ese reinicio, así que esos cortes no dejaban registro propio.
- **Al acabar cada corte, la página volvía 26-52 s por detrás de lo entregado**, invisible para las muestras porque el
  reloj del vídeo sigue: el espectador volvía a ver lo que los backups acababan de enseñar. Eso es el "desync". En el
  de las 15:31Z del 20 el player de Twitch lo rechazó con `PlayerRecoverableError Segment`, 2 s en pausa y un salto de
  +23 s.

**La causa: el formato nuevo de Twitch (desde el 19).** Durante un corte cosido la playlist de la página ya no desliza:
se clava en el primer segmento del pod, lista el pod entero (16 números para 30 s) y debajo va añadiendo el contenido
en directo **con `PROGRAM-DATE-TIME` adelantado lo que dura el pod y numerado a continuación del anuncio** (su player
retoma donde cortó el anuncio, 26 s por detrás del directo, en vez de saltar). Al acabar, la sesión de la página queda
con `MEDIA-SEQUENCE` +14 y fechas +26 s respecto a la cuenta real, y se acumula por corte (+14, +29, +42 en la pestaña
de esportmaniacos del 20). Nuestra alineación era por fecha (`pageRebase` y `sequenceShift`): por fecha la página
"continuaba" la entrega (shift 0) cuando en realidad su segmento siguiente tenía contenido 26 s más viejo, y en el corte
siguiente la referencia de la página (fechada +24 s) hacía que un backup al borde del directo saliera 12 números atrás
(`shift +1, newest 5567` contra 5579 en el log).

**La pieza que lo arregla: `#EXT-X-TWITCH-LIVE-SEQUENCE`.** Es el número del primer segmento de la ventana en la cuenta
del propio directo, igual en todos los tokens: en los backups coincide con su `MEDIA-SEQUENCE` (138 de 138 el 20) y en
la página `MEDIA-SEQUENCE − LIVE-SEQUENCE` es constante entre cortes y salta exactamente en cada pod (sesión de la
página relativa a su carga, p. ej. 995 contra 4667 en teshrak; `ELAPSED-SECS`/`TOTAL-SECS` sí van en la línea de tiempo
desplazada, no sirven). Desde la 1.0.8: `pageShift = LIVE − MEDIA` en cada poll de la página sin anuncio
(`followLiveSequence`; durante el corte se conserva el anterior, que da al primer número del pod el del segmento que
sustituye, lo que necesitan merge y blancos), los backups se alinean con su propio `liveShift` (0), y el F-24 deja pasar
un retroceso de hasta 3 números al cambiar de fuente (`SEQUENCE_SLACK`: las dos líneas prefetch de la página más un
poll). La alineación por fecha queda de reserva para playlists sin la etiqueta y para los tests sintéticos.

**Why:** la fecha ya no es la verdad en la sesión de la página; la cuenta del directo sí. Y un reinicio del worker tiene
que contar como pega del corte, o no se ve.

**How to apply:** al leer registros desde el 21, `workerRestarts` y `stepsBack` en `npm run records`; `pageRebased` con
`live: true` y shift negativo al final de cada corte es lo normal (es el pod descontado), no una anomalía. Si la
numeración vuelve a fallar, lo primero es comprobar en las playlists del registro que `LIVE-SEQUENCE` siga igualando el
`MEDIA-SEQUENCE` de los backups y siga siendo constante en la página entre cortes (el script de un rato:
`seq − live` por playlist). Lo de que un `t` que salta a 0 en las muestras es un reinicio del player, y que un
rebobinado de contenido no se ve en las muestras, también vale para la próxima vez. Relacionado:
[[twitch-intercambio-verificado-primer-midroll-real]], [[pendientes]].
