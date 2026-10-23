---
name: twitch-intercambio-verificado-primer-midroll-real
description: Los siete primeros midrolls reales con el intercambio activo en el Chrome de Fran (2026-10-16 a 18): todos los polls con anuncio se sirvieron con backups a la calidad del player, pero en uno (esportmaniacos, 84 s, la última pestaña antes de su F5) la cadena cayó cinco veces a autoplay 360p porque los cinco tipos web venían con anuncios a la vez, y Fran vio la imagen congelada hasta F5; el cuarto (nissaxter) se vio perfecto y el quinto (ohnepixel, 74 s de anuncio a 1080p60, ya con la cadena del 17) fue limpio del todo: 40/40 intercambios entre site y popout, sin 360p, sin parón, fotogramas creciendo; el sexto y el séptimo (ibai, 107 y 52 s a 1080p60) igual de limpios salvo un reinicio evitable del player por backups un número por detrás, que desde el 18 se cubre repitiendo la última playlist. De ahí: contaminación de 2 s en vez de 5, el backup que solo anuncia su corte se usa saneado, se repite la última playlist de la misma calidad antes de bajar a 360p, y el guardián reinicia por imagen congelada. Doce más del 18 (tarde) al 22 (ibai, caedrel, caedrel247; las nueve de caedrel del 22 con la 1.0.1): todos limpios, y el único artefacto fue el reinicio al FINAL de cada corte en caedrel247 (segmentos de 1 s, anuncios de 2 s: la cuenta de la página queda 19 números por detrás de los backups), que desde el 22 cubre el `pageRebase`. Catorce más el 23 (jaimemellado_, 1.0.2): doce limpios; en los cortes de varios pods el segundo pod cose el anuncio en los cinco tipos web a la vez (los tokens nuevos se unen al pod en marcha) y, agotado el `held`, la cadena acaba en autoplay 360p por diseño (6 s y 40 s, sin reinicio ni parón): un `offQuality` con todos los backups en `ads` no es fallo de la cadena. Cómo leer un lote nuevo: `npm run records`.
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

**El sexto y el séptimo (2026-10-18 18:00 y 18:45 UTC, ibai, 1080p60):** `twitch-2026-10-18T18-02-14-730Z-break.json`
y `twitch-2026-10-18T18-46-24-300Z-break.json`. MIDROLL pod 1 los dos, anunciados 2 s antes (prefetch quitadas,
nunca pedidas). El primero: 107 s según el worker (segmentos de anuncio en la playlist de la página unos 50 s y
luego `twitch-maf-ad` hasta el final; la petición client-side respondida vacía), 33 polls, **33 `swapped`, 0
`held`/`merged`/`blanked`**, cadena `site` (14 s) → `popout` (28 s) → `site`, 1920 px las 136 muestras, ningún
parón, ningún fotograma repetido, UI de anuncio 0. Pero a los 42 s, cuando `popout` anunció su corte y se
pidieron los cuatro tokens web nuevos, **los cuatro iban un número por detrás de lo último entregado (798 frente
a 799)**: el worker usó `site` igualmente ("kept as the last choice") y el F-24 reinició el player por retroceso
de secuencia, `Idle → Ready → Buffering → Playing` en 0,7 s y `currentTime` a 0. Un parpadeo evitable: dos
segundos después `site` ya listaba 799 y 800. El segundo: 52 s, **31/31 `swapped`**, misma cadena site → popout →
site con desplazamiento +1, `mobile_web` volvió con `ads` y no se usó, 1920 px las 82 muestras, ningún parón,
0 reinicios. Patrón en los dos: el backup `site` anuncia su propio corte a los 14 s de entrar y `popout` a los
22-28 s. **Cambio del 18:** cuando todos los backups limpios van por detrás del último número entregado, antes de
usar uno (y reiniciar) se repite la última playlist de la misma calidad si tiene menos de 3 s (`holdLast`, el
mismo contador `held`); al siguiente poll están a la par y no hay retroceso. Ojo con la evidencia: el recorte del
registro a 1,2 MB deja solo las **10 últimas** playlists (`worker.recent` y `breakEnds[].playlists`), así que en
un corte largo las del momento interesante ya no están; si hace falta verlas, comprimir el registro
(`CompressionStream`) antes de mandarlo al service worker.

**Doce cortes más, del 2026-10-18 (tarde) al 22** (leídos el 22 con `npm run records`, que resume cada corte de los
registros; cada registro lleva todos los cortes de su pestaña y solo 300 s de muestras, así que cada corte se lee del
primer registro que lo contiene). ibai 19:05, 20:05 y 20:45 UTC del 18 (62, 54 y 54 s), caedrel 21:07 del 18 (56 s),
caedrel247 15:06, 15:31 y 15:43 del 19 (76, 40 y 54 s, 1.0.0, llegado por raid) y **nueve de caedrel el 22 con la
1.0.1** (10:03 pod 5 de 184 s, 10:28, 11:20, 12:11, 12:37, 13:03 pod 5 de 98 s, 13:34, 13:59 pod 2, 14:25; 31 a 53
polls cada uno). En los doce: **todos los polls `swapped` a 1080p60**, 0 `held`, 0 `merged`, 0 `blanked`, 0 caídas a
360p, 1920 px en todas las muestras, ningún parón de reloj ni de imagen, UI de anuncio 0, guardián 0. La cadena es
siempre `site` ↔ `popout` cada 2-4 s (cada uno anuncia su corte y entra el otro con token nuevo; `mobile_web` entró
dos veces, `frontpage`/`embed` vienen a ratos con `ads`). `backupBehind` sale 4-8 veces por corte pero nunca llegó a
`held` ni a reinicio: siempre había otro a la par. Dos cosas menores: ibai 20:45:27 tuvo un `Buffering` de 2 s a
mitad de corte (`readyState` 2, `paused`, fotogramas +3) y siguió solo; y el `MEDIA-SEQUENCE shift` de los backups en
caedrel crece a lo largo del día (0 → 4 → 5 → 6 → 7 → 11 → 12 → 13): cada corte deja la cuenta de la página un poco
por delante de la de un token nuevo (el segmento corto de 0,3 s del final del pod cuenta como número), inofensivo
porque va hacia delante.

**El artefacto de caedrel247: reinicio al final de cada corte, tres de tres.** El canal emite segmentos de **1 s**
y Twitch cose anuncios de **2 s**: durante el corte la playlist de la página avanza un número cada 2 s y los backups
uno por segundo, así que al acabar la página vuelve **19, 3 y 10 números por detrás** de lo último entregado
(`sequence back 91148 -> 91129 at a change of source (… -> page)`), el F-24 hace pause/play, `Idle → Ready →
Buffering → Playing` en 1 s y `currentTime` a 0 (las muestras lo enseñan: `t 204 → 19`). En canales con segmentos
de 2 s (ibai, caedrel, ohnepixel) los anuncios también son de 2 s y la página vuelve 1-2 por delante, como va el
HLS en vivo: no pasa nada. Y en el pod 5 de caedrel (13:03 del 22) la página volvió 5 por delante y `t` siguió a
1 s/s sin salto: hacia delante el player lo absorbe. **Cambio del 22 (`pageRebase`, 1.0.2):** al volver una playlist
de la página tras una entrega de otra fuente, se le calcula con la misma alineación por `PROGRAM-DATE-TIME` que a
los backups lo que hay que sumarle para continuar lo último entregado (+21 en el caso de las 15:07: su 91127 pasa
a 91148), y ese desplazamiento (`state.pageShift`) se aplica a **todas** las playlists de la página hasta el
siguiente master (que lo pone a 0); los backups del corte siguiente se alinean a la página ya desplazada, que es
la numeración que conoce el player. Con segmentos iguales a ambos lados sale 0 y no toca nada; hacia delante
sale negativo y también se aplica, por continuidad. Evento `pageRebased` (`shift`, `total`) y `worker.pageShift`
en el registro. Prueba sintética en `test/twitch-playlists.mjs` con los números de caedrel247, ibai y caedrel.
**Verificado la misma tarde en cuatro cortes reales de caedrel247 con la 1.0.2** (15:36 de 69 s, 16:26 de 129 s,
17:03 pod 3 de 109 s, 17:16 de 77 s; 41 a 73 polls, todos `swapped` a 1080p60 salvo un `held` que funcionó): al
acabar cada uno `page playlist numbered +11 / +11 / +20 / +5` (offset acumulado +47), **ningún `sequence back`,
ningún pause/play**, `t` siguiendo a 1 s/s y 60 fotogramas/s a través del final del corte. El offset acumulado deja
a la página 1-3 números por delante de cada token nuevo (el `ceil` de cada renumerado) y el `shift` de los backups
crece 0 → 1 → 2 → 3: hacia delante, inofensivo. El primero fue con la pestaña oculta (298 de 300 muestras): el player
de Twitch se bajó solo a 360p y los backups le siguieron a 360p (`offQuality` 6), y `frames` no crece con la
pestaña oculta aunque `t` sí; por eso el guardián exige pestaña visible, y un `offQuality` con `hidden` alto no es
un fallo de la cadena.

**Catorce cortes más el 2026-10-23 (jaimemellado_, 1080p60, 1.0.2, leídos ese día con `npm run records`):** 12:06 pod
3 de 86 s, 12:21 (126 s), 12:36, 13:03 pod 6 de 162 s, 13:29, 13:44, 13:54, 14:10, 14:20, 14:35 (88 s), 14:46 (104 s),
15:01 pod 3 de 82 s, 15:12 y 15:53 UTC; 25 a 68 polls cada uno. Los once de un solo pod: **todos los polls `swapped` a
1080p60**, 0 `held`, 1920 px en todas las muestras, ningún parón de reloj ni de imagen, UI de anuncio 0, 0 reinicios
(`pageRebase` renumeró -2/-4/+1/-1 cuando tocó: la página vuelve 1-4 números por delante, como en ibai, y el player lo
absorbe). **Lo nuevo está en los tres cortes de varios pods.** El primer pod va como siempre (`site` ↔ `popout` cada
2-4 s, cada uno anuncia su corte y entra el otro con token nuevo, limpio en su primer poll). Pero al arrancar el
**segundo pod** (12:07:24, 13:04:51 y 15:02:52) el backup en uso anuncia su corte, se piden los cuatro tokens web y
**los cuatro vuelven ya con segmentos de anuncio** (`site=ads frontpage=ads mobile_web=ads embed=ads`), y el que
anunció pasa a `ads` 1 s después: un token pedido con el pod en marcha se une a él y trae el anuncio cosido desde el
primer segmento, sin el anuncio previo que en el primer pod daba 2-4 s limpios. El worker sirve el anunciado saneado,
repite la última playlist (`held` a 0,3 / 1,2 / 2,1 s) y sigue pidiendo los cinco tokens cada 3-4 s: en el de las 15:01
al siguiente poll ya había 1080p limpio (`held` 1, `offQuality` 0); en el de las 12:06 el 1080p volvió a los 6 s y en
el de las 13:03 **a los 40 s** (once rondas de cinco tokens, todas `ads`; solo `autoplay`, platform android a 360p30,
venía limpio). En esos dos el player vio `autoplay@360p30` (`videoWidth` 640 en 6 y 40 muestras), con un `Buffering →
Playing` de 1 s al cambiar, `t` y fotogramas sin saltos, sin reinicio, sin UI de anuncio, y volvió a 1920 px solo.
Es el último recurso por diseño: contenido a 360p antes que `merge` + blank (pantalla en negro a 1080p); no hay
sesión web sin anuncio en ese tramo y el worker lo comprobó cada 3-4 s. Por comparar: los pods 5 de caedrel del 22
(10:03 y 13:03) no hicieron esto, sus tokens nuevos del segundo pod en adelante llegaban limpios; depende del canal o
de cómo Twitch rellena el pod, no de la cadena. El `PlayerError MasterPlaylist "not a valid M3U8"` 8-10 s antes de
cada corte sigue siendo el master `picture-by-picture` respondido vacío (está en todos los registros del 22 y del 23).

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
player, y un `sequenceRestart` precedido de `backupBehind` es el reinicio por backups atrasados (con el hold del 18
debería salir `backupHeld` en su lugar). Si vuelve a congelarse sin caídas a 360p, la siguiente hipótesis es el salto entre tokens (cada
2-4 s una playlist de otro token con URLs distintas para los mismos números): no cambiar de fuente más
de una vez por N s. Un registro se descarga tras **cada** corte cosido aunque todo vaya bien: que haya
fichero no significa fallo, significa que hubo corte. Con un lote nuevo de registros, lo primero es
`npm run records -- --since=<fecha>`: un corte limpio es `swapped` = `polls`, `offQuality` 0, `clockStill` y
`pictureStill` 0, `adUi` 0 y sin `RESTART` ni `sequenceRestart`; un `sequenceRestart` justo en `endedAt`
(`… -> page`) es el caso de caedrel247 y desde el 22 debería salir `pageRebased` en su lugar, con `t` siguiendo
sin volver a 0. Un `offQuality` > 0 con `held` 3 justo antes y, en el log del worker, `site=ads … embed=ads` ronda
tras ronda es el segundo pod del 23: Twitch cosiendo el anuncio en todos los tokens web; la cadena hizo lo previsto
y solo tendría sentido tocar algo si Fran prefiere negro a 1080p antes que 360p. Queda por ver un PREROLL de carga y un corte con
el player a 720p60 o 480p. Relacionado:
[[twitch-sonda-corte-cosido-real-y-los-siete-backups-limpios]] (la sonda que lo decidió),
[[twitch-ningun-player-type-garantiza-stream-sin-anuncios]].
