# Canal de actualizaciones — diseño

## Contexto

Ninguno de los tres artefactos (cliente, `lumid`, Indexer) se actualiza solo hoy: `lumi
install` reinstala desde un checkout, y el cliente y el Indexer son binarios de Tauri sin
canal de release. `FUTURO.md` lo dejaba planteado con cuatro incógnitas — dónde vive el
canal, si `lumid` se actualiza solo, cómo migran los datos de SQLite, y qué esquema de firma
usar. Esta spec las cierra las cuatro.

Mockup completo de todas las superficies (cinta del cliente, panel de administración, tres
direcciones de instalador exploradas): [docs/superpowers/specs/2026-08-26-canal-mockup.html](2026-08-26-canal-mockup.html).

## Alcance

- Un manifiesto de versiones firmado, servido por una API mínima en Vercel.
- Detección y verificación de firma en los tres artefactos.
- Aviso discreto (cinta) en cliente e Indexer, con enlace a la descarga.
- Actualización de `lumid` completa desde el panel de administración: descarga, verificación,
  mantenimiento, copia de seguridad, sustitución del binario, reinicio.
- Instalador Inno Setup propio para cliente e Indexer (Windows), con UI custom — dirección
  **C** del mockup (placa lateral con pasos + fondo de planeta, cuerpo dinámico a la derecha).

Fuera de alcance (con su motivo, para no reabrir la discusión sin razón nueva):

- **Canales `beta`/`estable`**: un solo canal hasta que haya alguien a quien darle el otro.
- **Panel web para publicar**: publicar es un commit; una UI no ahorra nada todavía.
- **Motor de migraciones de SQLite**: ya existe `migrate()` en `store.rs` con su techo anotado;
  esta spec no lo toca.
- **Rollback automático de `lumid`**: pediría una segunda unidad de systemd con `OnFailure=`
  que habría que instalar, vigilar y explicar. Hoy es `lumi rollback`, manual.
- **Cliente e Indexer en Linux**: el manifiesto ya trae el campo `plataforma`; añadirlo después
  es publicar un artefacto más, no rediseñar nada.
- **Rotación de la clave de firma**: va compilada en los tres binarios. Rotarla exige una
  versión puente que sepa validar con la clave vieja y la nueva a la vez; se diseña cuando la
  clave necesite rotar, no antes.
- **Actualización automática sin intervención** en ninguno de los tres: el cliente y el
  Indexer llevan al usuario a la descarga, no instalan solos; `lumid` la aplica el owner desde
  el panel, nunca por su cuenta.

---

## 1. El manifiesto y su cadena de confianza

Formato en `web/releases/versiones.json`:

```json
{
  "version": 1,
  "clave_publica": "kR7v…Qc=",
  "publicaciones": [
    {
      "producto": "lumid",
      "version": "2.1.0",
      "publicado": "2026-08-26T10:00:00Z",
      "notas": "Cola: reintento acotado por muerte de trabajador…",
      "retirada": false,
      "artefactos": [
        {
          "plataforma": "linux-x86_64",
          "url": "https://github.com/…/lumid-2.1.0",
          "bytes": 24117248,
          "sha256": "9f2c…a1"
        }
      ]
    }
  ],
  "firma": "MC4C…=="
}
```

`producto` es `"cliente" | "lumid" | "indexer"`. `plataforma` hoy solo toma
`"windows-x86_64"` para cliente/Indexer y `"linux-x86_64"` para `lumid`; el campo existe para
que añadir una plataforma nueva sea publicar un artefacto más, no cambiar el formato.

**Lo firmado es el documento completo con `firma` en cadena vacía** — mismo truco que
`Ficha::canonico()` en `crates/lumi-index/src/ficha.rs`, para que el proyecto tenga un solo
idioma de firma en vez de dos. La cadena de confianza es deliberada en cada eslabón:

```
clave pública (compilada) → firma el manifiesto → manifiesto contiene sha256 → sha256 verifica los bytes
```

Ni Vercel ni GitHub son de confianza: Vercel puede servir un manifiesto viejo pero no uno
inventado (no tiene la clave privada); GitHub puede servir bytes corruptos o distintos pero
no que pasen el hash. No hay «confiar igualmente» — si la firma no valida, el manifiesto
entero se descarta.

## 2. `lumi-proto` — lo compartido

Módulo nuevo `crates/lumi-proto/src/actualizacion.rs`. Es el único crate que alcanzan los
tres binarios (`client/src-tauri` solo depende de `lumi-proto`, no de `lumi-index`), así que
aquí vive todo lo reusable:

```rust
pub const CLAVE_PUBLICA: [u8; 32] = [ /* embebida en compilación */ ];

pub struct Manifiesto {
    pub version: u32,
    pub clave_publica: String,
    pub publicaciones: Vec<Publicacion>,
    pub firma: String,
}

pub struct Publicacion {
    pub producto: Producto,       // enum: Cliente | Lumid | Indexer
    pub version: String,
    pub publicado: String,
    pub notas: String,
    pub retirada: bool,
    pub artefactos: Vec<Artefacto>,
}

pub struct Artefacto {
    pub plataforma: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

impl Manifiesto {
    /// Serializa con `firma` vacía — lo que realmente se firmó.
    pub fn canonico(&self) -> Vec<u8> { /* … */ }

    /// Ed25519 contra CLAVE_PUBLICA. Si falla, el manifiesto entero se descarta.
    pub fn comprobar(&self) -> Result<()> { /* … */ }

    /// La publicación aplicable de `producto` para `plataforma`, si es más
    /// nueva que `version_actual` y no está retirada. `None` si no hay nada
    /// nuevo o la única disponible está retirada.
    pub fn mas_nueva(&self, producto: Producto, version_actual: &str, plataforma: &str)
        -> Option<&Publicacion> { /* … */ }
}
```

Comparación de versiones: parseo directo a `(u32, u32, u32)`, sin dependencia externa.
Ponytail: no soporta sufijos de pre-release (`2.1.0-rc1`); el día que haga falta, ese día se
añade — hoy no hay canal beta que lo necesite.

`indexer/src-tauri/Cargo.toml` gana `lumi-proto = { path = "../../crates/lumi-proto" }` como
dependencia directa (hoy solo depende de `lumi-index`).

**Tests**: `mas_nueva()` y `comprobar()` son la lógica no trivial de esta spec — entran en
`cargo test -p lumi-proto` junto a los de `key`/`crypto`/`caps` que ya existen ahí. Casos:
manifiesto con firma corrupta, versión igual (no es "más nueva"), versión retirada (no se
ofrece aunque sea mayor), plataforma que no aparece en `artefactos`.

## 3. Cliente e Indexer — la cinta

Un comando Tauri `comprobar_actualizacion()`: descarga el manifiesto, lo verifica, llama a
`mas_nueva(Producto::Cliente, version_actual_de_tauri_conf, "windows-x86_64")`. Se ejecuta:

- Una vez al arrancar, sin bloquear el arranque — la llamada es asíncrona y la cinta aparece
  si y cuando hay respuesta.
- Detrás de un botón manual en Ajustes.

**Sin red no es un error.** No se pinta nada — ni un aviso rojo, ni un ícono de alerta. Un
investigador en una máquina aislada no debe ver una alarma por esto en cada arranque. Solo el
botón manual, si se pulsa, puede mostrar el estado "sin conexión" con la fecha de la última
comprobación buena.

**Firma inválida** descarta el manifiesto igual que en el servidor — no hay estado intermedio
de "quizá".

La cinta (`app-cinta` del mockup): banda superior en `elevated`, ícono `draw-fg` (estado "en
curso" de la tabla de DESIGN.md), versión en mono con `tabular-nums`, un detalle secundario
truncado con las notas, botón "Ver y descargar" que abre el navegador a la página de
descarga, y cierre con hit-area de 26×26. Entra con `jg-fade-rise`, respeta
`prefers-reduced-motion`. Si la versión instalada aparece como `retirada` en el manifiesto,
la cinta lo dice explícitamente ("Tu versión fue retirada") en vez de solo anunciar la nueva.

El botón **no descarga ni instala nada**: lleva a la página de descargas de la web (fuera de
alcance del backend de esta spec — hoy puede ser tan simple como un enlace directo al asset
de GitHub). Instalar es responsabilidad del instalador Inno (sección 5), no de la app en
ejecución.

## 4. `lumid` — detección, caché, panel

Sin pantalla propia, `lumid` reusa mecanismos existentes en vez de abrir un canal nuevo:

- **Consulta**: una vez al día en un tick de fondo, y bajo demanda vía el endpoint de abajo.
  El resultado (el `Manifiesto` ya verificado, o el error) se cachea en la tabla `meta`
  (`k`/`v`) que ya existe en `store.rs` — cero tablas nuevas, cero migración para esta parte.
- **Lectura**: `GET /v1/admin/actualizacion` (cualquier admin) devuelve versión instalada,
  versión disponible (si hay y no está retirada), notas, y la fecha de la última
  comprobación. Se cuela en el `telemetry::sample` existente para que la campana de avisos
  (ya construida) lo recoja sin trabajo adicional de UI.
- **Aplicar**: `POST /v1/admin/actualizacion/aplicar` — **solo el owner**, no cualquier
  admin. Reiniciar el servidor pesa más que gestionar usuarios o avisos.

### Secuencia de `aplicar`

Orden estricto: nada destructivo ocurre antes de que todo lo verificable esté verificado.

1. **Descargar y verificar.** Baja el artefacto de la URL del manifiesto, calcula su
   `sha256` y lo compara. Si no cuadra, aborta aquí — el servidor no se ha tocado.
2. **Entrar en `MAINTENANCE`.** Reusa el módulo existente en `mantenimiento.rs`: rechaza
   trabajo nuevo, no cancela el que corre.
3. **Esperar a que la cola vacíe** lo que está en vuelo. Sin tope de tiempo — la regla del
   proyecto es que el trabajo empezado no se cancela nunca. El panel enseña cuánto queda; el
   owner puede cancelar la actualización (sale de `MAINTENANCE`, nada se ha movido todavía)
   pero no forzar que un análisis a medias se mate.
4. **Copia de seguridad**: `VACUUM INTO` de `lumi.db` a `lumi.db.bak-<versión-instalada>`.
5. **Sustituir el binario**: `mv lumid lumid.viejo`, escribir el nuevo binario en su lugar,
   `systemctl restart lumid`. En Linux esto no exige detener nada antes de renombrar.
6. **Arrancar el nuevo binario.** Corre el `migrate()` existente en `store.rs` igual que en
   cualquier arranque normal, y sale de `MAINTENANCE`.

Durante el paso 5 el panel pierde la conexión y lo dice ("reiniciando…"); vuelve solo cuando
el nuevo proceso responde — la reconexión ya está resuelta en otra parte del cliente.

**Rollback**: manual y a propósito. `lumid.viejo` se conserva; `lumi rollback` (CLI) lo
restaura junto con `lumi.db.bak-<versión>` si hace falta. Automatizarlo es el ítem marcado
fuera de alcance arriba.

### Panel de administración

Pestaña nueva "Actualizaciones" en `AdminPanel`, visible para todo admin pero con el botón
"Actualizar servidor" solo activo para el owner (mismo patrón de capacidad-con-razón que ya
usa el resto del panel — se enseña deshabilitado con el motivo, no se oculta). Tarjeta con:
versión instalada / disponible en mono, notas, tres botones (Actualizar servidor, Notas
completas, Comprobar ahora), y los cuatro estados posteriores del mockup: esperando cola,
reiniciando, firma inválida, huella que no cuadra.

## 5. Instalador Inno Setup — cliente e Indexer

Tauri v2 empaqueta en NSIS o WiX/MSI, no en Inno Setup — no hay atajo del bundler para esto.
El instalador es un paso propio:

- `tools/build.py` gana un subcomando (o una rama de `build`) que compila la app sin
  empaquetarla (`tauri build --no-bundle` o equivalente), y después invoca `ISCC` sobre un
  script `.iss` propio por app (`client/installer/lumi-station.iss`,
  `indexer/installer/lumi-indexer.iss`).
- El `.iss` desactiva el wizard de serie de Inno y dibuja páginas custom en Pascal Script,
  siguiendo la dirección **C** del mockup: panel izquierdo fijo (marca, fondo de planeta
  reducido con el mismo `PlanetBackground` en valores estáticos, lista de pasos con el punto
  `hecho`/`ahora` ya visto en el stepper del wizard) y panel derecho que cambia por página
  (licencia, ubicación, opciones, progreso). Reusa los tokens de color de DESIGN.md
  traducidos a los que Pascal Script necesita (no hay CSS dentro de Inno, así que esto es
  color/fuente por control, no una hoja de estilos).
- Windows-only por ahora — es la decisión ya tomada; Linux queda como campo de manifiesto sin
  rellenar hasta que alguien lo pida.
- Publicar `/SILENT` como flag soportado: es lo que permite que una versión futura de la
  propia app dispare su instalador de actualización sin abrir ventana, aunque *disparar* esa
  actualización desde dentro de la app queda fuera de alcance de esta entrega (sección
  "Fuera de alcance").

**Firma del instalador**: el `.exe` que produce Inno es justamente el artefacto que
`tools/release.py` hashea y sube a GitHub Releases — el instalador en sí no lleva firma
Ed25519 propia embebida; la firma protege el manifiesto que apunta a él y el `sha256` que lo
identifica, no el binario en sí (firmar el `.exe` con un certificado de Authenticode de
Windows es un problema aparte, de confianza del SO, no de este canal).

## 6. Publicar una versión

`tools/release.py` (nuevo): dado un directorio con los artefactos ya construidos y subidos a
GitHub Releases, calcula sus `sha256`, pide la clave privada (`~/.lumi/release.key`, nunca en
el repo ni en Vercel), firma el manifiesto y reescribe `web/releases/versiones.json`. Publicar
y retirar una versión son ambos un commit + push — el historial de publicaciones es el
historial de git del repo de la web, auditable sin infraestructura adicional.

## 7. La API en Vercel

`web/`, Next.js con App Router, hosteado en Vercel (framework ya decidido para el
subsistema 9 completo, esta es su primera esquina). Un único endpoint:

`GET /api/versiones` → lee `releases/versiones.json` del propio bundle desplegado y lo
devuelve tal cual — sin filtrar, sin parámetros, con CORS abierto y cache HTTP. Sin filtrado
en servidor la firma cubre exactamente lo que se sirve; en cuanto el servidor recorta la
respuesta, deja de poder garantizar eso.

Es funcionalmente equivalente a servir el JSON como estático desde `public/` hoy. El route
handler existe porque es donde el subsistema 9 meterá filtrado por canal el día que haga
falta — anotado como ponytail: el techo es "cuando haya un segundo canal que filtrar", no
antes.

## Errores — resumen

| Situación | Cliente/Indexer | `lumid` |
|---|---|---|
| Sin red | Silencioso; última comprobación buena visible bajo demanda | Igual; el panel enseña la fecha |
| Firma inválida | Manifiesto entero descartado, sin aviso de versión | Igual, y el panel lo dice explícitamente |
| `sha256` no cuadra | — (la cinta no descarga bytes) | Aborta en el paso 1 de `aplicar`, servidor intacto |
| Versión instalada retirada | Cinta lo anuncia explícitamente | Panel lo anuncia explícitamente |
