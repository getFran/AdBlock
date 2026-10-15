---
name: mv3-main-world-document-start-se-inyecta-al-insertar-html
description: Un content script MV3 en world MAIN con run_at document_start, registrado declarativamente, se inyecta de forma síncrona al insertarse <html> y antes de cualquier script de la página (Chromium script_injection_manager.cc), así que sirve para parchear fetch/Worker a tiempo; scripting.executeScript desde el service worker llega tarde, y declarativeNetRequest no puede tocar cuerpos de respuesta.
metadata:
  type: project
  idea: bloqueador-de-anuncios-para-chrome-twitch-y-youtube
---

Verificado el 2026-10-15 en el código de Chromium `main`: `HTMLHtmlElement::InsertedByParser()` dispara
`RunScriptsAtDocumentElementAvailable()`, que en `extensions/renderer/script_injection_manager.cc` acaba
en `StartInjectScripts(kDocumentStart)`. Es el mismo hook para ISOLATED y MAIN y corre antes de que el
parser vea el primer `<script>`. Condiciones: el script tiene que estar **registrado declarativamente**
(`content_scripts` del manifest o `scripting.registerContentScripts` con `world: "MAIN"`), ser una IIFE
sin `import()` (en MAIN no hay `chrome.runtime`) y respetar la CSP de la página. uBO Lite lo usa así en
producción (`scripting-manager.js`, scriptlets `main`/`isolated`). `scripting.executeScript` lanzado desde
el service worker **no** llega a tiempo (FAQ de uBOL).

`declarativeNetRequest` solo hace `block`, `redirect`, `allow`, `upgradeScheme`, `modifyHeaders` y
`allowAllRequests`; la única API que reescribe cuerpos, `webRequest.filterResponseData`, es exclusiva de
Firefox. Límites (docs 2026-10-15): 30.000 reglas estáticas garantizadas, 100 rulesets (50 activos),
30.000 dinámicas, 1.000 regex por tipo. Conversor off-the-shelf de EasyList a DNR: `@adguard/dnr-converter`
2.0.0 (2026-09-29, GPL-3; no convierte `$replace`, `$jsonprune`, `$hls`); rulesets ya hechos en
`@adguard/dnr-rulesets`. MV2 está muerto en Chrome estable: deshabilitado para todos en 138, policy
retirada en 139, store purgada el 2026-08-31, `--load-extension` quitado en 137.

**Why:** todo lo que no sea bloquear una URL (podar un JSON, cambiar una playlist HLS, hookear un
Worker) depende de que el parche llegue antes que la página; sin esta garantía el diseño entero de
Twitch y YouTube sería una carrera perdida.

**How to apply:** declarar los scripts de MAIN world en el manifest con `run_at: document_start`, nunca
inyectarlos desde el service worker; mantener la lógica de red "bloqueable" en DNR y todo lo demás en
inyección. Para cargar sin publicar: "Load unpacked" con el toggle de modo desarrollador encendido
(Chrome 134+ lo exige para que siga activa).
