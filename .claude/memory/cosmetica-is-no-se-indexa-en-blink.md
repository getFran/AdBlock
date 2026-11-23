---
name: cosmetica-is-no-se-indexa-en-blink
description: 2026-11-23, "Amazon va muy mal" — la hoja cosmética genérica escrita como bloques `:is(a,b,c…){display:none}` hacía que Blink comparase cada elemento con los 16.006 selectores en cada recálculo de estilos (9,4 s por carga en los resultados de amazon.es); una regla por selector lo deja en 0,6 s. Cómo se midió y qué variantes se descartaron.
metadata:
  type: project
---

**El síntoma** (Fran, 2026-11-23): "la extensión hace que amazon vaya muy mal". Reproducido en el Chromium de
Playwright (Chrome 156) con `dist/` cargado, métricas por CDP `Performance.getMetrics`:

| página | con la extensión | con amazon.es desactivado |
| --- | --- | --- |
| `amazon.es/` (7-8k nodos) | recálculo de estilos 2,5 s, 13 long tasks (2,7 s) | 0,10 s |
| `amazon.es/s?k=…` (25k nodos) | recálculo de estilos **9,4 s**, 32 long tasks (9,9 s, la mayor 1,7 s) | 0,27 s |

Layout, script y red iguales en los dos casos: lo que se dispara es solo `RecalcStyleDuration`, o sea la hoja
cosmética. Las reglas DNR bloquean en Amazon solo telemetría (`unagi.amazon.es`, `uedata`, `metrics.jpg`) y
el bucket de `amazon.es` tiene 5 selectores: no era "qué se bloquea", era cómo se escribía la hoja genérica.

**La causa.** `cssFor` escribía la hoja genérica (y la del dominio) en bloques `:is(sel1,…,sel400){display:none!important}`
porque `:is()` admite una lista indulgente (un selector inválido no tira la regla). Blink indexa cada regla por el
id/clase/etiqueta de su último compuesto para probar solo las candidatas; cuando ese compuesto es una lista `:is()` de
varios selectores, no la indexa y la regla va al cubo universal: **todos los elementos se prueban contra las 400
alternativas de los 41 bloques en cada recálculo**. Microbenchmark en la misma página de resultados, misma lista de
16.006 selectores (todos válidos en Chrome 156: 0 rechazados por `insertRule`), adoptando la hoja y luego 100 toggles de
clase forzando estilo:

| variante | recálculo al adoptar | 100 toggles | ocultos |
| --- | --- | --- | --- |
| `:is()` × 400 (lo que había) | 798 ms | 760 ms | 1166 |
| lista plana `a,b,c{}` × 400 | 13 ms | 32 ms | 1166 |
| **una regla por selector** | 17 ms | 30 ms | 1166 |
| una regla por selector, sin `[attr*=]` | 9 ms | 10 ms | 1166 |
| solo `#id`/`.clase` | 5 ms | 9 ms | 1166 |
| `:is()` × 400 solo de `#id`/`.clase` | 966 ms | 216 ms | 1166 |

La última fila confirma que es el `:is()` y no los selectores caros: con solo ids y clases dentro del `:is()` sigue
costando lo mismo. El parseo es igual en todas (2-4 ms) y la memoria privada del renderer no distingue las variantes
(el ruido de la propia página es de ±70 MB).

**Lo que se hizo (1.0.10):** una regla `sel{display:none!important}` por selector en `src/cosmetic/runtime.js`. Se
descartó la lista plana por bloques porque un selector que Chromium rechace tiraría los 400 de su bloque sin aviso
(hoy no hay ninguno, pero las listas cambian cada semana); con reglas sueltas se pierde solo él, que es la misma
indulgencia que daba `:is()`. Resultado con la extensión entera: 0,16 s en la portada y 0,62 s en los resultados
(frente a 0,10 / 0,27 sin extensión), 6 long tasks de 100 ms en vez de 32 de hasta 1,7 s.

**Why:** una hoja de 16k selectores es cara o barata según cómo la indexe el motor, no según cuántos selectores
tenga; el truco de la lista indulgente desactivaba el índice y lo pagaba cualquier página grande, no solo Amazon.

**How to apply:** `npm run verify -- generic` mide ahora el recálculo de estilos de los resultados de amazon.es con la
extensión activa y avisa "TOO SLOW" por encima de 1,5 s: si una queja de "va lento" vuelve, lanzarlo primero. Nunca
volver a envolver listas largas en `:is()`/`:where()` en el último compuesto, tampoco en la hoja del dominio. Si algún
día hiciera falta ir más allá (una página de 100k nodos), el siguiente escalón es el de uBO: inyectar solo los
selectores genéricos cuyos ids/clases aparecen en el DOM, no toda la lista.
