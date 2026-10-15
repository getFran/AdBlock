# CLAUDE.md — Bloqueador de anuncios para Chrome (Twitch y YouTube)

Scaffold creado por ProjectKit el 2026-10-15 con la plantilla `blank`: **el stack técnico está sin
decidir a propósito**. La infraestructura compartida está en el `CLAUDE.md` de
`PyCharm Projects`, que se carga solo: **no la dupliques aquí**.

## Qué es esto

Una extensión de Chrome (Manifest V3) que **bloquea anuncios en cualquier web** con listas de filtros tipo EasyList y que **trata aparte Twitch y YouTube**, donde los bloqueadores genéricos fallan porque el anuncio va cosido en el propio vídeo (Twitch) o protegido por detección y contramedidas (YouTube). En palabras de Fran: "bloquear todos los anuncios de páginas web, sobre todo me interesa para Twitch y YouTube". Solo para él: cargada descomprimida en modo desarrollador, sin publicar en la Chrome Web Store. Situación de partida comprobada: uBlock Origin (MV2) ya no se puede cargar en Chrome estable por ningún flag (deshabilitado para todos en Chrome 138, julio de 2025; borrado de la store el 2026-08-31), y uBlock Origin Lite declara en su FAQ que no bloquea de forma fiable los anuncios de vídeo de Twitch.

Croquis de decisión: `ProjectKit/ideas/bloqueador-de-anuncios-para-chrome-twitch-y-youtube.md`. Ahí están el MVP acordado, la incógnita
crítica ya resuelta y por qué merecía repo propio. **Léelo antes de proponer arquitectura**: la
decisión de hacer este proyecto se tomó con ese alcance, no con otro.

## Coordenadas

| | |
|---|---|
| Repo | `getFran/AdBlock` (privado — **debe seguirlo**) |
| Rama | `main` |
| Despliegue | **ninguno**: no es un servicio de `dockerhost`, no tiene stack ni puerto |

## Primera sesión de desarrollo

Se eligió `blank` porque este proyecto no es un servicio web con el molde de la casa. Antes de
escribir código, acuerda con el usuario y **anota aquí mismo**:

1. **Lenguaje y toolchain** (Rust/Tauri, Go, C#, Node, Python…), y cómo se compila y se prueba.
2. **Forma de entrega**, que es lo que de verdad cambia el proyecto:
   - **Ejecutable de escritorio** (Windows/Linux/macOS): los binarios **no se committean**.
     Van a GitHub Releases; si se quiere build automática, un workflow de GitHub Actions por
     plataforma. Ojo: el homelab despliega con Portainer GitOps, que aquí no aplica.
   - **CLI / librería**: cómo se instala y si se publica en algún registro.
   - **Extensión de navegador**: carga desatendida en local vs. subir a la store; el
     `manifest.json` manda.
   - **Cliente + servidor** (como `metadraft`): el cliente vive aquí, y el servidor puede
     necesitar su propio stack. Si añades un `docker-compose.yml` a este repo, monta el stack y
     el webhook con ProjectKit (`kit stacks` para ver los existentes) y saca puerto con
     `python -m kit ports` — nunca a ojo, hay que escanear las dos fuentes.
3. **Si el proyecto necesita `.env`**: real y committeado, nunca `.env.example` (el repo es
   privado). Y actualiza el `.gitignore`, que ahora solo cubre basura de SO y de editor.

Cuando esté decidido, sustituye esta sección por las convenciones reales del proyecto. Que un
`CLAUDE.md` siga diciendo "sin decidir" tres semanas después es la señal de que nadie lo mantiene.

## Memoria del proyecto

Las memorias de este repo viven en `.claude/memory/` — un hecho por fichero, más `MEMORY.md` de
índice — y se commitean con él. **Escribe, actualiza y lee ahí; nunca en `~/.claude`**: así
viajan con el repo a cualquier máquina y las hereda cualquier agente que lo clone.

Si lo que surge es específico de **otro** proyecto, su memoria va al `.claude/memory/` de aquel,
no a este: la memoria se guarda donde vive su tema, no donde se ejecuta la sesión.

@.claude/memory/MEMORY.md
