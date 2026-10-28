<p align="center">
  <a href="https://github.com/bcgrillo/copilot-web">
    <picture>
      <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
      <img src="assets/logo-light.svg" alt="logo de Copilot Web" width="120" height="120">
    </picture>
  </a>
</p>

<p align="center"><strong>Copilot Web</strong> — una interfaz web mínima y autoalojada para la<br><a href="https://github.com/github/copilot-cli">Copilot CLI de GitHub</a>, sobre ACP.</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square" /></a>
  <a href="https://github.com/bcgrillo/copilot-web/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bcgrillo/copilot-web/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/bcgrillo/copilot-web/actions"><img alt="Beta" src="https://img.shields.io/badge/estado-beta-orange.svg?style=flat-square" /></a>
  <a href="https://github.com/bcgrillo/copilot-web/issues"><img alt="Issues" src="https://img.shields.io/github/issues/bcgrillo/copilot-web?style=flat-square&label=issues" /></a>
  <a href="https://github.com/bcgrillo/copilot-web/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.1.4-blue.svg?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Español</a>
</p>

<p align="center">
  <img src="assets/mockup.png" alt="Copilot Web — barra de sesiones y ventana de chat" width="760" />
</p>

---

**copilot-web** es una interfaz web mínima y autoalojada para la
[Copilot CLI de GitHub](https://github.com/github/copilot-cli). Habla con la
Copilot CLI por **ACP** (el [Agent Client
Protocol](https://agentclientprotocol.com/protocol/v1/overview) de
`copilot --acp`), dejando
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
- **Notificaciones de sistema (opt-in)** — con la pestaña en segundo plano, al
  terminar un turno llega una notificación del navegador, un contador de no
  leídos en el título y un punto en el favicon.
- **Cero datos materializados** — `copilot` ACP es la única fuente de verdad.
  La web mantiene una pequeña caché en memoria que se descarta al reiniciar; el
  historial se repite desde ACP (`session/load`). Nada se escribe en disco.
- **Interfaz EN/ES** — inglés por defecto con español autodetectado (idioma del
  navegador); los operadores pueden fijarla al arrancar con `--lang es`.
- **Login + auth por bearer** — UI protegida por contraseña con access tokens
  de vida corta y refresh tokens rotados de un solo uso (ver Autenticación).

## Requisitos

- Node.js **>= 20**
- Un shell tipo POSIX (Linux, macOS, WSL)
- La `copilot` CLI instalada y autenticada (`copilot` en `PATH`,
  `--acp` soportado — probado contra `1.0.80`)

## Inicio rápido

Sin clonar — usa el instalador de la última release (autocontenido: descarga
él mismo el tarball de la release):

```bash
curl -fsSL https://github.com/bcgrillo/copilot-web/releases/latest/download/install.sh -o install.sh
sh install.sh
# → http://localhost:3100
```

O desde un checkout:

```bash
git clone https://github.com/bcgrillo/copilot-web.git copilot-web
cd copilot-web
sh scripts/install.sh      # instala deps, compila y arranca
# → http://localhost:3100
```

En ambos casos, `install.sh` instala dependencias, compila y arranca el único
launcher, que levanta a la vez el daemon ACP (`copilot --acp`, puerto 3222)
y el servidor web (puerto 3100).

Si queda un daemon de una ejecución anterior, el launcher lo reutiliza en vez
de abrir otro.

Entorno: el daemon se arranca con un entorno mínimo depurado; las credenciales
del proveedor Copilot y el modelo vienen de `copilot-web/.env.local`
(`COPILOT_PROVIDER_*` / `COPILOT_MODEL`). Si tu shell ya exporta esas variables,
no hay nada que hacer; si no, escríbelas una vez en `.env.local`.

## Opciones de la CLI

El instalador crea un symlink `~/.local/bin/copilot-web`, así que los comandos
de abajo funcionan desde cualquier directorio. Alternativas: `npm i -g .` instala
el comando globalmente, o ejecútalo desde un clon con
`node copilot-web/bin/copilot-web.mjs`.

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
| `--no-auth` | off | Arrancar esta instancia con autenticación desactivada (por defecto: auth ON) |
| `--add-user <u> [--password <pw>]` | — | Crear un usuario de la UI (contraseña por prompt si se omite); contraseñas débiles avisan, no bloquean |
| `--set-password <u> [--password <pw>]` | — | Cambiar la contraseña de un usuario (revoca sus sesiones) |
| `--del-user <u>` | — | Eliminar un usuario (y revocar sus sesiones) |
| `--list-users` | — | Listar usuarios (nunca se muestran credenciales) |
| `--revoke <u>` / `--revoke-all` | — | Revocar al instante los tokens de un usuario / de todos |
| `--helper-token` | — | Imprimir el token interno del helper MCP (para `COPILOT_WEB_TOKEN`) |

Por defecto **no se pasan flags extra**: `copilot --acp` pide permiso por ACP
para las tools restringidas, y la web muestra una tarjeta permite/deniega por
cada petición. El valor especial `--copilot-args "allow-all"` se traduce a
`--allow-all-tools --allow-all-urls --allow-all-paths` (sin prompts de
permisos). Pasa tus propios flags para restringir más al agente.

## Autenticación

Por defecto la autenticación está **activada**; el servidor se niega a arrancar
sin usuarios configurados (usa `--no-auth` para sacar auth en una instancia
puntual, p. ej. un contenedor desechable):

```bash
copilot-web --add-user admin --password s3cret   # usuario con hash scrypt
copilot-web                                      # auth on, pantalla de login
copilot-web --no-auth                            # auth off para esta instancia
```

- La UI muestra una pantalla de login; después cada llamada lleva un header
  `Authorization: Bearer <access>`.
- El login emite un **access token** corto (15 min) y un **refresh token** de
  un solo uso (90 días, rotado en cada refresh; refrescar con un refresh ya
  usado revoca la cadena rotada — detección de reuso).
- Las contraseñas se guardan con scrypt y sal por usuario, más un pepper HMAC
  cuya clave (`~/.copilot-web/auth.json`, `chmod 600`) se genera en el primer
  arranque. Borrar ese archivo revoca todos los logins. Los tokens sobreviven
  a reinicios del servidor.
- `--set-password`, `--revoke`, `--revoke-all` y `--del-user` invalidan tokens
  al instante.
- El helper MCP `ask_user` se autentica con un token interno permanente (el
  launcher lo inyecta automáticamente en la config del helper).
- Exentos del bearer: `/api/login`, `/api/auth/state`, `/api/auth/refresh` y
  `/api/openapi` (la documentación de la API).

## Despliegues separados (back + front)

Un mismo build puede correr como servidor único, backend-solo o frontend-solo
— se elige con `APP_MODE`:

| Env | Default | Aplica a | Descripción |
| --- | --- | --- | --- |
| `APP_MODE` | `all` | servidor | `all` = UI + API (monolito self-host) · `api` = contenedor backend (la UI responde 404) · `front` = frontend puro (`/api/*` responde 404) |
| `CORS_ALLOW_ORIGIN` | *(vacío)* | servidor | Acceso cross-origin a `/api/*` desde un front separado: un origen exacto, lista por comas, o `*`. Sin valor no hay headers CORS (solo mismo origen, e.g. tras el proxy) |
| `NEXT_PUBLIC_API_URL` | *(vacío)* | **build time** | URL absoluta del backend para un front separado, e.g. `http://localhost:3100` |

El backend documenta la superficie completa como OpenAPI 3.1: `GET
/api/openapi` (servido por el propio servidor, disponible en modo `api` —
cualquier UI o fork puede consumir el contrato sin leer el código).

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

## Hoja de ruta

Trabajo planificado (beta oficial = serie `v0.1.x`):

- **Buscador de sesiones** — filtrar sesiones por título desde el sidebar.
- **Mensajes encolados durante el turno** — sigue escribiendo mientras corre
  un turno: los mensajes nuevos se encolan y se intercalan en la conversación
  en marcha, como en el Copilot CLI.
- **Memoria `allow_always` de shell** — recordar prefijos de comandos shell
  aprobados durante la sesión en vez de preguntar por cada comando exacto.
- **Renderizado de creación/edición de ficheros** — mostrar los cambios
  de ficheros como lo hace el CLI de Copilot (contenido y diffs unificados).

## Licencia

GPL-3.0
