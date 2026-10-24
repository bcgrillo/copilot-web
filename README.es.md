<p align="center">
  <a href="https://github.com/lualab-xyz/copilot-web">
    <picture>
      <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
      <img src="assets/logo-light.svg" alt="logo de copilot-web" width="120" height="120">
    </picture>
  </a>
</p>

<p align="center"><strong>copilot-web</strong> — una interfaz web mínima y autoalojada para la<br><a href="https://github.com/github/copilot-cli">Copilot CLI de GitHub</a>, sobre ACP.</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square" /></a>
  <a href="https://github.com/lualab-xyz/copilot-web/actions"><img alt="Tests" src="https://img.shields.io/badge/tests-pendientes-lightgrey.svg?style=flat-square" /></a>
  <a href="https://github.com/lualab-xyz/copilot-web/actions"><img alt="Beta" src="https://img.shields.io/badge/estado-beta-orange.svg?style=flat-square" /></a>
  <a href="https://github.com/lualab-xyz/copilot-web/issues"><img alt="Issues" src="https://img.shields.io/github/issues/lualab-xyz/copilot-web?style=flat-square&label=issues" /></a>
  <a href="https://github.com/lualab-xyz/copilot-web/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.0.32-blue.svg?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Español</a>
</p>

---

**copilot-web** es una interfaz web mínima y autoalojada para la
[Copilot CLI de GitHub](https://github.com/github/copilot-cli). Habla con la
Copilot CLI por **ACP** (el Agent Client Protocol de `copilot --acp`), dejando
las sesiones, el contexto y los permisos donde viven: en el proceso de la CLI.

> **Sin afiliación** — este es un proyecto comunitario no oficial. No está
> afiliado, avalado ni patrocinado por GitHub, Microsoft u OpenAI.
> “GitHub Copilot” es una marca registrada de GitHub, Inc.

Esto es una **beta**: espera bordes ásperos y cambios entre releases. Los
comentarios son bienvenidos — abre un issue con lo que funcionó, lo que no y tu
plataforma.

## Qué incluye

- **Gestor de sesiones** — lista, crea, renombra y borra sesiones directamente
  en la CLI (`session/list`, `/session new|rename|delete`). Sin base de datos local.
- **Ventana de chat** — respuestas en streaming, razonamiento del agente,
  chips de tool calls, adjuntar ficheros, comandos `/slash`, cancelar un turno en marcha.
- **Permisos en el navegador** — cuando la CLI pide permiso, aparece una tarjeta
  en el chat; permite o deniega sin tocar el terminal.
- **Helper ask-me (MCP)** — la web registra una pequeña tool MCP (`ask_user`)
  en el daemon: cuando el agente necesita una decisión a mitad de turno, aparece
  una tarjeta de pregunta en el chat y el turno en marcha espera tu respuesta
  (timeout 5 min).
- **Cero datos materializados** — `copilot` ACP es la única fuente de verdad.
  La web mantiene una pequeña caché en memoria que se descarta al reiniciar; el
  historial se repite desde ACP (`session/load`). Nada se escribe en disco.
- **Interfaz EN/ES** — inglés por defecto con español autodetectado (idioma del
  navegador); los operadores pueden fijarla al arrancar con `--lang es`.

## Requisitos

- Node.js **>= 20**
- Un shell tipo POSIX (Linux, macOS, WSL)
- La `copilot` CLI instalada y autenticada (`copilot` en `PATH`,
  `--acp` soportado — probado contra `1.0.80`)

## Inicio rápido

```bash
git clone <github repo> copilot-web
cd copilot-web
sh scripts/install.sh      # instala deps, compila y arranca
# → http://localhost:3100
```

La instalación/arranque es un único launcher que levanta el daemon ACP
(`copilot --acp`) y el servidor web:

```bash
npx copilot-web                     # web en :3100 + daemon en :3222
```

Si queda un daemon de una ejecución anterior, el launcher lo reutiliza en vez
de abrir otro.

Entorno: el daemon se arranca con un entorno mínimo depurado; las credenciales
del proveedor Copilot y el modelo vienen de `copilot-web/.env.local`
(`COPILOT_PROVIDER_*` / `COPILOT_MODEL`). Si tu shell ya exporta esas variables,
no hay nada que hacer; si no, escríbelas una vez en `.env.local`.

## Opciones de la CLI

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `--port <n>` | `3100` | Puerto del servidor web |
| `--acp-port <n>` | `3222` | Puerto del daemon ACP |
| `--cwd <dir>` | directorio actual | Working directory de las sesiones |
| `--copilot-args <s>` | *(ninguno)* | Argumentos extra para `copilot --acp` |
| `--lang <en\|es>` | navegador | Idioma de la UI (por defecto, el del navegador; se quitó la persistencia de la elección — `--lang` lo fija) |
| `--model <id>` | auto | Modelo para `copilot --acp` (solo aplica si el launcher abre un daemon nuevo); se muestra en la barra de estado |
| `--build` | off | Ejecutar `next build` antes de arrancar |
| `--no-daemon` | off | Esperar un daemon ya en marcha, no abrir uno |
| `--no-helper` | off | No registrar la tool MCP `ask_user` de la web en el daemon (el helper aplica a daemons recién abiertos; en reuso imprime un aviso) |

Por defecto **no se pasan flags extra**: `copilot --acp` pide permiso por ACP
para las tools restringidas, y la web muestra una tarjeta permite/deniega por
cada petición. El valor especial `--copilot-args "allow-all"` se traduce a
`--allow-all-tools --allow-all-urls --allow-all-paths` (sin prompts de
permisos). Pasa tus propios flags para restringir más al agente.

## Cómo funciona

```
navegador ⇄ servidor web Next.js (:3100) ⇄ daemon copilot --acp (:3222) ⇄ GitHub Copilot
```

Publicar bajo un **prefijo de ruta** (p. ej. detrás de un proxy que strippea un
path público) en vez de `/` está soportado con `ASSET_PREFIX` +
`NEXT_PUBLIC_BASE_PATH` — ver
[docs/base-path-deployment.md](docs/base-path-deployment.md). En una release
futura será un simple flag `--base-path` del launcher.

Una sesión ACP por sesión web; cambiar de sesión en el sidebar cambia de sesión
ACP de forma transparente (las sesiones del agente viven en el daemon y son
repetibles con `session/load` mientras esté arriba). La barra de estado bajo el
composer muestra el working directory de la sesión, la rama git (sondeada,
puede cambiar mientras trabajas) y el modelo cuando se fijó con `--model`.

## Privacidad

Todo corre en localhost contra tu propia suscripción de Copilot. La web no
almacena, exporta ni envía tus chats a ningún servidor; el único estado
persistente es el que ya gestiona la propia Copilot CLI.

## Límites conocidos (beta)

- Los timestamps de los mensajes y los pensamientos del agente vienen solo del
  stream en vivo (ACP `session/load` aún no los repite); tras reiniciar el
  servidor web estos detalles desaparecen, la transcripción en sí se repite completa.
- El dashboard solo es una sesión profunda en la CLI (`/session rename`) y los
  errores de la CLI se muestran tal cual.
- **Sin autenticación ni autorización (authN/authZ)** en la UI web de momento —
  cualquiera que alcance el puerto tiene acceso completo a tu Copilot. Una capa
  básica de auth de usuario único está en el roadmap; hasta entonces, haz bind
  a localhost o ponla detrás de tu propio proxy.

## Hoja de ruta

Trabajo planificado (ninguno bloquea el lanzamiento de la beta; la versión
siempre se mantendrá en semver de 3 dígitos, `v0.0.x` durante la beta — el
lanzamiento oficial de la beta será `v0.1.x`):

- **Auth básica (authN/authZ)** — login de usuario único para la UI web.
- **Pipelines de CI (GitHub Actions)** — lint/comprobación de tipos/build más
  una suite de tests, conectada al badge de tests de arriba.
- **Buscador de sesiones** — filtrar sesiones por título desde el sidebar.
- **Eventos en vivo intercalados** — mostrar progreso/eventos a mitad de turno,
  en el espíritu del CLI de GitHub.
- **Memoria `allow_always` de shell** — recordar prefijos de comandos shell
  aprobados durante la sesión en vez de preguntar por cada comando exacto.
- **Renderizado de creación/edición de ficheros** — mostrar los cambios
  de ficheros como lo hace el CLI de Copilot (contenido y diffs unificados).

## Licencia

GPL-3.0
- **Renderizado de creación/edición de ficheros** — mostrar los cambios
  de ficheros como lo hace el CLI de Copilot (contenido y diffs unificados).
