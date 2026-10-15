# Bloqueador de anuncios para Chrome (Twitch y YouTube)

Una extensión de Chrome (Manifest V3) que **bloquea anuncios en cualquier web** con listas de filtros tipo EasyList y que **trata aparte Twitch y YouTube**, donde los bloqueadores genéricos fallan porque el anuncio va cosido en el propio vídeo (Twitch) o protegido por detección y contramedidas (YouTube). En palabras de Fran: "bloquear todos los anuncios de páginas web, sobre todo me interesa para Twitch y YouTube". Solo para él: cargada descomprimida en modo desarrollador, sin publicar en la Chrome Web Store. Situación de partida comprobada: uBlock Origin (MV2) ya no se puede cargar en Chrome estable por ningún flag (deshabilitado para todos en Chrome 138, julio de 2025; borrado de la store el 2026-08-31), y uBlock Origin Lite declara en su FAQ que no bloquea de forma fiable los anuncios de vídeo de Twitch.

Scaffold generado por ProjectKit el 2026-10-15 a partir del croquis
`ProjectKit/ideas/bloqueador-de-anuncios-para-chrome-twitch-y-youtube.md`.

## Estado

Repo recién creado con la plantilla `blank`: stack técnico sin decidir. No es un servicio de
`dockerhost` — no tiene `docker-compose.yml`, ni stack de Portainer, ni puerto asignado.

## Siguiente paso

Abre una sesión en esta carpeta y decide lenguaje, toolchain y forma de entrega (ejecutable,
CLI, extensión, cliente+servidor). El `CLAUDE.md` de este repo lleva la lista de lo que hay que
acordar antes de escribir código.

> Repo privado: si en algún momento lleva credenciales en un `.env` committeado (la convención
> del homelab), **debe seguir siéndolo**.
