---
name: twitch-intercambio-verificado-primer-midroll-real
description: Los cinco primeros midrolls reales con el intercambio activo en el Chrome de Fran (2026-10-16 a 18): todos los polls con anuncio se sirvieron con backups a la calidad del player, pero en uno (esportmaniacos, 84 s, la última pestaña antes de su F5) la cadena cayó cinco veces a autoplay 360p porque los cinco tipos web venían con anuncios a la vez, y Fran vio la imagen congelada hasta F5; el cuarto (nissaxter) se vio perfecto y el quinto (ohnepixel, 74 s de anuncio a 1080p60, ya con la cadena del 17) fue limpio del todo: 40/40 intercambios entre site y popout, sin 360p, sin parón, fotogramas creciendo. De ahí: contaminación de 2 s en vez de 5, el backup que solo anuncia su corte se usa saneado, se repite la última playlist de la misma calidad antes de bajar a 360p, y el guardián reinicia por imagen congelada.
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
verlo". Con el reloj corriendo, eso es un **decodificador de vídeo atascado mientras el audio sigue**:
el reloj del `<video>` lo lleva la pista de audio, `currentTime` corre, no hay `waiting` y la imagen se
queda en el último fotograma. El guardián de la página solo miraba `currentTime` y no reaccionó.

**Qué corte fue, en realidad:** la misma pestaña siguió sin F5 hasta después de las 13:06:43 (los
registros de las 14:46 y las 15:06 contienen los tres cortes de la sesión: 11:51 pausenpaii, 12:44
esportmaniacos de 60 s y **13:04:59 esportmaniacos de 84 s**), así que la congelación que recuerda es
casi seguro la del último: 44 polls, 24 cambios de fuente y **cinco caídas a `autoplay` 360p** de 1,6 a
2,5 s cada una, con `MEDIA-SEQUENCE` desplazado +1, porque `frontpage`, `mobile_web` y `embed` volvían
con **segmentos de anuncio** (`ads`, no solo anunciados: un token pedido en pleno corte trae su propio
pod) y `site`/`popout` se contaminaban a los 2-4 s; con la contaminación de 5 s de Purple el pool de
1080p60 se vaciaba y entraba el 360p. Un cambio de resolución dentro de la misma variante, cinco veces
en 84 s, es el sospechoso principal del decodificador atascado (Purple vio 6 s de imagen parada con su
vaivén 720p↔360p, T-819). Segundo sospechoso, ya quitado: el `#EXT-X-DISCONTINUITY` del anuncio que
colgaba al final de las playlists de aviso. Ninguno está demostrado.

**El cuarto corte (2026-10-17 02:47, nissaxter, build con fotogramas):** 54 s, 31/31 polls con backup,
20 cambios de fuente, una sola caída a 360p de ~2 s, fotogramas creciendo todo el rato (56.440 →
60.766), ningún parón, UI de anuncio 0, reinicios 0; Fran: "funcionó perfecto". Un `PlayerError
ErrorInvalidData MasterPlaylist "Response body is not a valid M3U8"` 10 s antes del corte es la
respuesta vacía al master `picture-by-picture` que pide la página (lo mismo que hace Purple; inofensivo
hasta ahora).

**El quinto corte (2026-10-18 08:42 UTC, ohnepixel, 1080p60, el primero largo con la cadena del 17):**
`twitch-2026-10-18T08-45-16-102Z-break.json`. MIDROLL anunciado 2 s antes (2 prefetch quitadas, nunca
pedidas), pod declarado 3 pero los segmentos de anuncio de la página fueron creciendo de 3 a 25 (unos
74 s, último poll con anuncio a las 08:43:38); el worker dio el corte por acabado a los 151 s. 40 polls,
**40 `swapped`, 0 `held`, 0 `merged`, 0 `blanked`**, todos a 1080p60 con `MEDIA-SEQUENCE` +0, alternando
`site` y `popout` cada 2-4 s (cada uno se "anuncia" y se sanea, el otro entra con token nuevo; `frontpage`,
`mobile_web` y `embed` venían a ratos con `ads` y no se usaron; `autoplay` nunca). Vídeo: 1/s desde 2 min
antes hasta 20 s después, `videoWidth` 1920 las 177 muestras de la ventana, **ningún parón de reloj, ningún
fotograma repetido** (16.988 → 27.367), `dropped` 1 → 3, UI de anuncio 0, reinicios 0, pestaña visible.
La petición client-side (`edge.ads.twitch.tv`, bp=midroll) respondida vacía 2 min antes. Fran no notó nada.

**Cambios (2026-10-16 y 17):** `blankAds` quita también el `DISCONTINUITY` y el `MAP` posteriores a un
corte anunciado; las muestras llevan `frames` (`getVideoPlaybackQuality().totalVideoFrames`),
`dropped`, `videoWidth`, `error`, nº de `<video>` y visibilidad; el guardián vigila desde el primer
poll con anuncio hasta 60 s después del fin y reinicia (pause/play, luego reload suave) cuando el reloj
**o la imagen** llevan 6 s parados con la pestaña visible; `verify` cuenta "picture frozen" como fallo;
se registran `playerState`/`playerError`. Y en la cadena, para no bajar a 360p: contaminación de **2 s**
(el token nuevo está listo en 0,3 s), un backup que **solo anuncia** su corte no se descarta sino que se
sirve saneado (igual que el aviso de la página), y si aun así no hay nada a la calidad del player se
**repite la última playlist** de esa calidad si tiene menos de 3 s (`held` en el resumen del corte);
`autoplay` 360p queda detrás de todo eso.

**Why:** demuestra que la parte de playlists funciona en el Chrome real (ningún segmento de anuncio
llegó al player en cuatro cortes) y, a la vez, dos cosas que Purple no cuenta: que `currentTime` no
basta como evidencia de "se ve" (sin fotogramas un registro dice que todo fue bien mientras Fran mira
una imagen congelada), y que con tokens que vuelven con su propio pod el pool de la calidad del player
se vacía con la contaminación de 5 s y el player recibe cambios de resolución. Cualquier veredicto
futuro tiene que mirar `frames` y la lista de calidades de `backups`.

**How to apply:** en el siguiente corte, mirar primero `samples[].frames` en la ventana del corte: si
dejan de crecer con `t` avanzando, es el mismo fallo; `restarts[]` dirá si el guardián lo arregló
(`why: 'picture'`) y en cuánto; `breakEnds[].backups` dirá cuántas veces entró `autoplay@360p` y
`held` cuántas se repitió una playlist; `events` con `playerState`/`playerError` dan la versión del
player. Si vuelve a congelarse sin caídas a 360p, la siguiente hipótesis es el salto entre tokens (cada
2-4 s una playlist de otro token con URLs distintas para los mismos números): no cambiar de fuente más
de una vez por N s. Un registro se descarga tras **cada** corte cosido aunque todo vaya bien: que haya
fichero no significa fallo, significa que hubo corte. Queda por ver un PREROLL de carga y un corte con
el player a 720p60 o 480p. Relacionado:
[[twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios]] (la sonda que lo decidió),
[[twitch-ningun-player-type-garantiza-stream-sin-anuncios]].
