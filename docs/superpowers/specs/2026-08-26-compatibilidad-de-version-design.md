# Compatibilidad de versión cliente↔servidor — diseño

## Contexto

El canal de actualizaciones ([2026-08-26-canal-de-actualizaciones-design.md](2026-08-26-canal-de-actualizaciones-design.md))
y el instalador compartido ([2026-08-26-instalador-compartido-design.md](2026-08-26-instalador-compartido-design.md))
resuelven cómo cada binario (cliente, Indexer, `lumid`) se entera de que existe una versión más
nueva de **sí mismo** y cómo instalarla. Ninguno de los dos resuelve un problema distinto: hoy
un cliente puede emparejarse y trabajar contra un `lumid` de una versión distinta a la suya sin
que nada lo impida ni lo señale. `GET /v1/hello` ya devuelve `version` (`crates/lumid/src/routes/hello.rs`)
y el cliente lo guarda en su store (`client/src/App.tsx`), pero nadie lo compara contra nada — es
puramente informativo.

Esta spec cierra ese hueco: el cliente debe negarse a entrar si su versión y la del servidor no
coinciden exactamente, y ofrecer un camino de salida en los dos sentidos posibles.

## Alcance

- Bloqueo de pairing/reconexión cuando `hello.version` del servidor difiere de la versión propia
  del cliente, en cualquier posición (major, minor o patch).
- Cliente más nuevo que el servidor: pantalla con dos acciones — pedir al servidor que
  actualice (crea una solicitud visible para el admin), o hacer downgrade del propio cliente a
  la versión del servidor.
- Servidor más nuevo que el cliente: pantalla con una acción — actualizar el cliente a la
  versión del servidor.
- Extensión de `lumi-proto::actualizacion` y del instalador compartido para poder instalar una
  versión **exacta** (no solo "la más nueva"), condición necesaria para el downgrade y para
  igualar una versión de servidor que no sea la última publicada.
- Garantía de que el manifiesto de versiones conserva el histórico de publicaciones — sin eso,
  igualar una versión de servidor vieja es imposible aunque el mecanismo de instalación lo
  soporte.

Fuera de alcance (con motivo):

- **UI de "buscar actualizaciones" manual para cliente/Indexer** (botón fuera del flujo
  automático, pantalla de "acerca de" con versión visible, etc.): es el siguiente sub-proyecto
  natural una vez esto esté implementado, pero es una superficie de UI distinta (ajustes/about,
  no un bloqueo de arranque) y no depende de nada de esta spec para diseñarse aparte.
- **Indexer**: no habla con `lumid` (`CLAUDE.md`, confirmado en código — no hay ningún endpoint
  ni consumo de `/v1/hello` en `indexer/`), así que el problema de compatibilidad cliente↔servidor
  no le aplica. Sigue usando únicamente el canal de actualizaciones de software existente.
- **Compatibilidad parcial (major.minor sí, patch no)**: se decidió deliberadamente exigir
  coincidencia exacta — más simple de razonar, sin necesidad de mantener disciplina sobre qué
  cambios "solo son patch" a nivel de protocolo.

---

## 1. Detección y bloqueo

`connect()` (`client/src-tauri/src/main.rs:279-294`) ya hace `GET /v1/hello` en cada `pair`,
`reconnect` y `pair_card`, pero deserializa la respuesta como `serde_json::Value` genérico. Pasa
a deserializar como el tipo `Hello` tipado y comparar `hello.version` contra
`env!("CARGO_PKG_VERSION")` con la misma lógica de comparación que ya existe en
`lumi-proto::actualizacion` (`comparar`/`partes`, hoy privadas y colgando de `Manifiesto` —
se extraen como funciones libres `pub` para poder reusarlas aquí sin arrastrar el resto del
canal de actualizaciones).

Si difieren en cualquier posición, `connect()` no completa el pairing/reconexión: devuelve un
resultado distinguible (nuevo variante, p. ej. `ConnectError::VersionIncompatible { propia,
servidor }`) en vez del error de conexión genérico actual. El lado TS lo traduce a un quinto
estado de `StatusOverlay.tsx` (mismo componente que ya cubre `reboot | error | sealed | lost`):
`"incompatible"`, con dos variantes de copy/acciones según quién es más nuevo.

## 2. Cliente más nuevo que el servidor

Pantalla con dos botones:

**Pedir al servidor que actualice.** `POST /v1/version-mismatch`, sin autenticación —incluso
antes de que exista sesión o pairing completo, igual que `access_requests`, que ya es "la única
superficie escribible sin credenciales" documentada como tal
(`crates/lumid/src/routes/access.rs`). Mismo régimen de protección: límite por IP/hora, límite
por IP/día, tope de pendientes global. Crea una fila en una tabla nueva
`version_mismatch_requests` (mismo esqueleto que `access_requests`/`credit_requests`: id,
version_cliente, ip, created_at, resolved_at) y emite una variante nueva de `EventoAdmin` —
`SolicitudVersion { version_cliente }` — por el SSE de admin ya existente
(`/v1/admin/events`).

`RequestsView.tsx` gana un tercer tipo en la unión discriminada (`tipo: "version"`), con su
propio icono, y una sola acción: **Descartar** (marca `resolved_at`). No hay nada que
aprobar/conceder aquí — a diferencia de acceso o crédito, el admin no decide nada dentro del
sistema, solo se entera y actualiza el servidor por su cuenta (con el mecanismo que ya existe en
`ActualizacionesView.tsx`).

**Descargar versión del servidor** (downgrade). Relanza `installer.exe --silencioso
--producto=cliente --pid=<pid> --version-objetivo=<hello.version>` — mismo binario y mismo
camino sin ventana que ya existe (`installer/src-tauri/src/silencioso.rs`), con un flag nuevo
que sustituye a `--version-actual=` cuando lo que hace falta es igualar una versión concreta, no
"la más nueva".

## 3. Servidor más nuevo que el cliente

Un único botón: **Actualizar cliente**, mismo mecanismo, mismo flag:
`installer.exe --silencioso --producto=cliente --pid=<pid> --version-objetivo=<hello.version>`.

## 4. Instalar una versión exacta, no solo "la más nueva"

Todo el canal de actualizaciones existente asume una sola pregunta: "¿hay algo más nuevo que lo
mío?" (`Manifiesto::mas_nueva`). Igualar la versión de otra parte —que puede ser más vieja que
la última publicada— necesita una pregunta distinta: "dame exactamente la versión X". Cambios:

- `Manifiesto::version_exacta(&self, producto: Producto, version: &str, plataforma: &str) ->
  Option<&Publicacion>` en `crates/lumi-proto/src/actualizacion.rs` — mismos filtros que
  `mas_nueva` (producto, plataforma, no retirada) pero comparando igualdad, no "más nueva que".
  Una versión exacta marcada `retirada` no se ofrece — mismo criterio de seguridad que ya aplica
  a `mas_nueva` (no reinstalar algo que el propio proyecto marcó como problemático), con el
  efecto de que un downgrade a una versión retirada queda bloqueado; se considera aceptable
  porque "retirada" ya significa "no instalar esto", sea cual sea la dirección.
- `installer/src-tauri/src/silencioso.rs` acepta `--version-objetivo=<x.y.z>` como alternativa a
  la resolución normal por "más nueva": cuando está presente, llama a `version_exacta` en vez de
  `mas_nueva`, y si no encuentra nada (versión no publicada para esa plataforma, o retirada),
  aborta sin tocar archivos y registra el error en `instalador.log` — mismo camino de error que
  ya existe para "sin publicación disponible".

## 5. El manifiesto tiene que conservar el histórico

Sin versiones viejas en `versiones.json`, `version_exacta` nunca encuentra nada para un
downgrade o para igualar un servidor atrasado. Hoy `tools/release.py` no borra publicaciones
explícitamente, pero tampoco hay ninguna garantía estructural de que cada `borrador.json`
incluya el histórico completo —depende de que quien arma el borrador se acuerde de copiar las
entradas anteriores. Esto se resuelve como parte del sistema de versiones en `tools/build.py`
(sub-proyecto siguiente, ya conversado): publicar una versión nueva **añade** una entrada al
manifiesto existente descargado de producción, nunca lo reemplaza desde cero. Esta spec deja la
dependencia anotada; la solución concreta (leer el manifiesto actual antes de publicar, fusionar,
volver a firmar) se diseña en ese sub-proyecto, no aquí.

## 6. Errores — resumen

| Situación | Comportamiento |
|---|---|
| `hello.version` == versión propia | Pairing/reconexión normal, sin cambios |
| `hello.version` != versión propia | `StatusOverlay` estado `"incompatible"`, pairing no se completa |
| Cliente más nuevo, elige "pedir actualización" | `POST /v1/version-mismatch` (sin auth, con límites), aparece en `RequestsView` |
| Cliente más nuevo, elige "downgrade" | `installer.exe --silencioso --version-objetivo=<version-servidor>` |
| Servidor más nuevo | `installer.exe --silencioso --version-objetivo=<version-servidor>`, única opción |
| `version_exacta` no encuentra artefacto (no publicado o retirado) | Instalador aborta sin tocar archivos, log + el cliente sigue en pantalla de bloqueo con el error |
| `POST /v1/version-mismatch` con tope de pendientes alcanzado | Rechaza como `access_requests` ya rechaza en el mismo caso |

## 7. Qué reemplaza / con qué convive

No reemplaza nada existente. Convive con:
- El canal de actualizaciones de software (`ActualizacionBanner`, autoactualización silenciosa
  disparada por el propio cliente al detectar una versión nueva de sí mismo) — ese mecanismo
  sigue funcionando igual, es ortogonal: compara contra el manifiesto, no contra un servidor
  concreto.
- `ActualizacionesView.tsx` del panel de admin — sigue siendo el único lugar donde el admin
  aplica la actualización de `lumid`; la solicitud nueva de esta spec solo le avisa de que hace
  falta, no la dispara por él.
