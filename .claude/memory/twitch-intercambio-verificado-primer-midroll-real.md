---
name: twitch-intercambio-verificado-primer-midroll-real
description: Primer corte cosido real con el intercambio activo en el Chrome de Fran (2026-10-16 13:51, pausenpaii, MIDROLL de 45 s): los 25 polls con anuncio se sirvieron con un backup limpio a 1080p60 y el reloj del vídeo avanzó sin parar, pero Fran vio la imagen congelada hasta pulsar F5: el decodificador de vídeo se atascó con el audio siguiendo, cosa que currentTime no muestra. Desde entonces se muestrean los fotogramas decodificados, el guardián reinicia también por imagen congelada, y el aviso de corte pierde su DISCONTINUITY/MAP colgantes. Los backups se contaminan cada 2-4 s y la cadena rota sin bajar calidad.
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

**El vídeo, según el registro:** muestras de 1/s desde 5 s antes hasta 30 s después: ningún parón de
2 s o más, nunca `paused`, `readyState` nunca por debajo de 3, `currentTime` 408,3 → 454,3 al acabar →
473,4 a los 30 s. UI de anuncio de Twitch: 0 muestras. Reinicios: 0.

**El vídeo, según Fran:** "se quedó congelado el directo y hasta que no hice F5 no pude volver a
verlo". Las dos cosas a la vez solo cuadran con un **decodificador de vídeo atascado mientras el audio
sigue**: el reloj del `<video>` lo lleva la pista de audio, así que `currentTime` corre, no hay
`waiting` y la imagen se queda en el último fotograma. El registro se escribió a las 11:52:11 UTC, así
que el F5 fue después: la congelación duró al menos desde el corte hasta entonces. El guardián de la
página solo miraba `currentTime` y no reaccionó. Sospechoso concreto: el aviso del corte (dos polls
antes) llegaba al player con el `#EXT-X-DISCONTINUITY` del anuncio colgando al final de la playlist
(Purple lo deja, regla 3), y el siguiente poll ya era el backup limpio sin discontinuidad: un
"pendiente de discontinuidad" aplicado a un segmento en vivo continuo puede descolocar la línea de
tiempo del vídeo. Es hipótesis, no está demostrado. Cambios del 2026-10-16 (commit siguiente a
`cb5bb21`): `blankAds` quita también el `DISCONTINUITY` y el `MAP` posteriores a un corte anunciado;
las muestras llevan `frames` (`getVideoPlaybackQuality().totalVideoFrames`), `dropped`, `videoWidth`,
`error`, nº de `<video>` y visibilidad; el guardián vigila desde el primer poll con anuncio hasta 60 s
después del fin, y reinicia (pause/play, luego reload suave) cuando el reloj **o la imagen** llevan
6 s parados con la pestaña visible; `verify` cuenta "picture frozen" como fallo; y se registran los
estados que el player manda a la página (`playerState`, `playerError`) para tener su versión.

**Why:** demuestra que la parte de playlists funciona en el Chrome real (ningún segmento de anuncio
llegó al player, calidad mantenida con los backups contaminándose cada pocos segundos) y, a la vez,
que `currentTime` no basta como evidencia de "se ve": sin fotogramas, un registro puede decir que todo
fue bien mientras Fran mira una imagen congelada. Cualquier verdict futuro tiene que mirar `frames`.

**How to apply:** en el siguiente corte, mirar primero `samples[].frames` en la ventana del corte: si
dejan de crecer con `t` avanzando, es el mismo fallo; `restarts[]` dirá si el guardián lo arregló
(`why: 'picture'`) y en cuánto; `events` con `playerState`/`playerError` dan la versión del player. Si
sigue congelándose con el DISCONTINUITY ya quitado, la siguiente hipótesis es el salto entre tokens
(el player recibe cada 2-4 s una playlist de otro token con URLs distintas para los mismos números):
probar a quedarse en el backup pin aunque anuncie su corte hasta que traiga segmentos de anuncio de
verdad, o a no cambiar de fuente más de una vez por N s. Queda por ver también un PREROLL de carga y un
corte con el player a 720p60 o 480p. Relacionado:
[[twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios]] (la sonda que lo decidió),
[[twitch-ningun-player-type-garantiza-stream-sin-anuncios]].
