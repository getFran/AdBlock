---
name: adguard-tracking-protection-bloquea-cualquier-host-umami
description: La lista Tracking Protection de AdGuard (ruleset_3) lleva `||umami.` sin condición de tercero, así que un panel de Umami autoalojado (umami.getfran.dev) carga el HTML pero pierde sus JS, CSS, manifest y favicons con ERR_BLOCKED_BY_CLIENT; la salida es el interruptor por sitio de la extensión, con getfran.dev desactivado por defecto, y no tocar la lista.
metadata:
  type: project
---

Visto el 2026-10-16: Fran abrió `umami.getfran.dev` con getFran AdBlock activa y el panel se quedó en el
logo. Otro agente leyó la consola desde Playwright: tres JS de la app, el manifest y los favicons con
`net::ERR_BLOCKED_BY_CLIENT`. En `dist/rulesets/ruleset_3.json` (AdGuard Tracking Protection) está la
causa: `{"urlFilter":"||umami.","excludedInitiatorDomains":["umami.is"]}`, un bloqueo de cualquier host
que empiece por `umami.` sin `domainType: thirdParty`, pensado para el tracker (`/script.js`) de las
instancias autoalojadas. Como la regla no cubre `main_frame`, la navegación entra y todo lo demás no.
La misma lista lleva `/umami.js` y `||umami.is^` (esta sí solo de tercero).

Comprobado con `npm run verify -- generic`: en `umami.getfran.dev/login` hay 19 peticiones bloqueadas
con todo activo y 0 con `getfran.dev` desactivado en el interruptor por sitio.

**Why:** la primera reacción es "la extensión bloquea mis cosas, quito la lista" o "añado una excepción a
mano a la lista"; ninguna de las dos es la carcasa: las listas se consumen tal cual y se actualizan con
`npm install`, y una excepción escrita a mano se perdería o habría que mantenerla. El interruptor por
sitio es el mecanismo que existe para esto y sobrevive a cualquier actualización.

**How to apply:** si una web propia o una app autoalojada se queda a medias con la extensión activa,
abrir la consola y buscar `ERR_BLOCKED_BY_CLIENT`; si es la extensión, desactivar el sitio desde el
popup (icono del perro → "Desactivar en <host>"; cubre subdominios y recarga la pestaña). `getfran.dev`
viene desactivado de fábrica por esto. Para saber qué regla fue: `grep` del host en `dist/rulesets/*.json`
o `globalThis.__adblock.testMatch(url, initiator, type)` en el service worker. Si el tracker de Umami de
las webs públicas (pem.lol, pickemsdb.lol) debe contar las visitas de Fran, esos dominios también van al
interruptor: con la lista activa, `umami.getfran.dev/script.js` se bloquea en cualquier web.
