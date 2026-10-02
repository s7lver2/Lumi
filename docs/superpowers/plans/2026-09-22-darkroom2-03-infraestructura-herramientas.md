# Darkroom 2 · 3 — Infraestructura de herramientas: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** este plan está pensado para que UN SOLO agente lo ejecute de principio a
> fin en orden, con este documento como única fuente de contexto (sin orquestación
> tarea-por-tarea con revisión intermedia por subagente distinto). Cada tarea es autocontenida
> y trae el código completo que necesita.

**Goal:** construir el andamiaje común que las herramientas de Darkroom 2 (Car ID,
Verify Image, Interiores, Objetos, Especies) usarán: un registro de herramientas con matriz de
capacidades, un gestor de VRAM que carga modelos por partes, el contrato de worker para
herramientas, un servicio de VLM/LLM compartido y enrutable (local / OpenRouter / endpoint
compatible con OpenAI), adaptadores de servicios externos auditados, un auditor IA con
abstención y calibración obligatoria, y las pistas de región con re-ponderación solo al
confirmarlas. No añade ninguna herramienta usable de cara al investigador.

**Architecture:** todo cuelga de `App`/`Queue` como los registros de modelos y niveles que ya
existen (`lumi_index::registro`, `lumi_index::niveles`). El registro de herramientas es
código (`fuentes.rs`, ya creado por el spec 2), no JSON, porque trae lógica. Los modelos y
niveles siguen siendo JSON en `registros/`. La configuración de servicios externos y del
enrutado del LLM se guarda con `Store::get_meta`/`set_meta`, igual que la clave del proveedor
de mapas (`map_key`) — sin tabla ni cifrado nuevos, siguiendo el precedente que ya existe en
el repo. Los workers de herramientas reutilizan el patrón de proceso hijo + JSON-lines de
`queue/worker.rs`. Toda escritura de caso pasa por `guard_case` y deja una entrada en
`bitacora` (spec 2).

**Tech Stack:** Rust (axum, rusqlite, reqwest, tokio), TypeScript/React (client existente).

## Global Constraints

- **Depende del spec 2 ya implementado**: existen `sources`, `resultados` (con columna
  `auditor TEXT`), `bitacora` con `bitacora::anotar`/`bitacora::verificar`, `pins`, `notas`, y
  `crates/lumid/src/fuentes.rs` con un registro inicial de tipos/herramientas
  (`fuentes::TIPOS`, `fuentes::HERRAMIENTAS`, `fuentes::admite`). Este plan **extiende**
  `fuentes.rs`, no lo crea.
- **No se añade ninguna herramienta usable** (Car ID, Verify Image, Interiores,
  Objetos, Especies). El registro queda con `geolocalizar` como única herramienta real y una
  herramienta de desarrollo `eco` que solo existe para ejercitar el contrato.
- **Objetivos de hardware por nivel** (del índice de Darkroom 2): Mini 8 GB VRAM / 16 GB RAM;
  Pro 12 GB VRAM / 32 GB RAM; Vision 24 GB VRAM o más, o el LLM enrutado a un proveedor
  externo.
- **Local por defecto**; todo servicio externo lo habilita el admin uno a uno con su clave, y
  cada envío deja una entrada en `bitacora` (acción `externo.enviado` / `externo.respondido`).
- **Los servicios externos son pasivos por defecto**: el soporte que construye aquí es el trait
  de adaptador y su política pasivo/activo genéricos. Un adaptador activo (que toca al objetivo
  o deja rastro) exige confirmación explícita del admin antes de cada ejecución.
- **El auditor sugiere, nunca decide**: escribe en `resultados.auditor` (columna ya existente
  del spec 2, formato JSON), nunca toca `resultados.revision`. No se activa sin calibración
  vigente.
- **Las pistas de región solo re-ponderan al confirmarse**, nunca automáticamente.
- **No hay tests salvo para lógica no trivial** (convención del repo): LRU del gestor de VRAM,
  resolución de capacidades, cadena de bitácora para envíos externos, expiración de
  calibración, re-ponderación de pistas. Se añaden con `#[cfg(test)] mod tests` en el propio
  fichero, como ya hace el resto de `crates/lumid/src`.
- **Sin licencias de modelo sin verificar**: ningún manifiesto de `registros/modelos/` se trata
  como instalable hasta que su `sha256`/`licencia_url` estén rellenos, siguiendo el patrón que
  ya existe en `lumi_index::registro::Modelo`.

---

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `crates/lumid/src/fuentes.rs` *(modificar)* | tipos `Herramienta`, `TipoResultado`, `RequisitosHerramienta`; registro extendido; `capacidad_de` |
| `crates/lumid/src/modelos.rs` *(nuevo)* | `GestorModelos` (LRU de VRAM), reservas y liberación |
| `crates/lumid/src/externos.rs` *(nuevo)* | trait `AdaptadorExterno`, registro, configuración vía `meta`, envío auditado |
| `crates/lumid/src/auditor.rs` *(nuevo)* | cliente de LLM/VLM (local/OpenRouter/compatible), esquema de veredicto, calibración |
| `crates/lumid/src/pistas.rs` *(nuevo)* | tabla `pistas_region`, confirmar/descartar, re-ponderación |
| `crates/lumid/src/queue/herramienta_worker.rs` *(nuevo)* | proceso hijo JSON-lines para herramientas (distinto del worker de embebido) |
| `crates/lumi-index/src/niveles.rs` *(modificar)* | `Nivel.herramientas: HashMap<String, Vec<String>>` (papel → ids de modelo) |
| `crates/lumi-proto/src/worker.rs` *(modificar)* | `TareaHerramienta`, `MsgHerramienta` |
| `crates/lumi-proto/src/api.rs` *(modificar)* | `Capacidad`, `EstadoCapacidad`, `VeredictoAuditor`, `PistaRegion`, `ConfigExterno` |
| `crates/lumid/src/routes/capacidades.rs` *(nuevo)* | `GET /v1/capacidades` |
| `crates/lumid/src/routes/externos.rs` *(nuevo)* | admin: listar/leer/escribir configuración, probar conexión |
| `crates/lumid/src/routes/calibracion_ia.rs` *(nuevo)* | admin: crear/leer calibraciones del auditor (distinto de `routes/calibracion.rs`, que es la calibración de verificadores geométricos) |
| `crates/lumid/src/routes/pistas.rs` *(nuevo)* | `PATCH /v1/pistas/:id` |
| `crates/lumid/src/routes/mod.rs`, `main.rs` | registrar rutas nuevas |
| `client/src/lib/api.ts` | tipos y llamadas nuevas |
| `client/src/admin/ServiciosExternosView.tsx` *(nuevo)* | panel de admin para adaptadores |
| `client/src/admin/AuditorView.tsx` *(nuevo)* | panel de admin para calibraciones |
| `client/src/admin/{Sidebar,AdminPanel}.tsx` | enlazar las dos vistas nuevas |
| `workers/lumi_herramienta_eco.py` *(nuevo)* | worker de desarrollo que ejercita el contrato |

---

## Task 1: Registro de herramientas con matriz de capacidades

**Files:**
- Modify: `crates/lumid/src/fuentes.rs`
- Test: en el propio fichero, `mod tests`

**Interfaces:**
- Consumes: nada nuevo (usa lo que el spec 2 ya dejó en este fichero: `TIPOS`, `HERRAMIENTAS`,
  `admite`).
- Produces: `pub struct Herramienta`, `pub enum TipoResultado`, `pub struct
  RequisitosHerramienta`, `pub enum EstadoCapacidad`, `pub fn registro() -> &'static
  [Herramienta]`, `pub fn capacidad_de(app: &crate::App, herramienta_id: &str, nivel: &str) ->
  EstadoCapacidad`. Las tareas siguientes (2, 3, 5, 6) construyen sobre estos nombres.

Primero, lee el fichero tal como lo dejó el spec 2 para confirmar los nombres exactos que ya
existen (`TIPOS`, `HERRAMIENTAS`, `admite`) antes de extenderlo — si un nombre difiere de lo
asumido aquí, adapta las firmas de esta tarea a los nombres reales y sigue igual con el resto
del plan.

- [ ] **Paso 1: añadir los tipos de capacidad y requisitos**

Al final de `crates/lumid/src/fuentes.rs`, añade:

```rust
/// Qué forma puede tener un resultado de esta herramienta. La interfaz nunca
/// ofrece una acción (coordenadas en el mapa, «fijar como pin», «crear fuente
/// a partir de esto») que la herramienta no declare aquí.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TipoResultado {
    pub coordenadas: bool,
    pub pista_region: bool,
    pub fuente_derivada: bool,
}

impl TipoResultado {
    pub const NINGUNO: Self = Self { coordenadas: false, pista_region: false, fuente_derivada: false };
    pub const GEO: Self = Self { coordenadas: true, pista_region: false, fuente_derivada: false };
}

/// Lo que hace falta para que una herramienta se pueda lanzar. `nivel_minimo`
/// se compara por posición en `crate::modelos::ORDEN_NIVELES` (Task 2): un
/// nivel más barato que el mínimo nunca es "disponible", aunque tenga todos
/// los modelos, porque el spec fija un piso de calidad por herramienta.
#[derive(Debug, Clone, Copy)]
pub struct RequisitosHerramienta {
    pub nivel_minimo: &'static str,
    /// Papel que se busca en `Nivel.herramientas` (Task 2). `None` si la
    /// herramienta no necesita ningún modelo propio (por ejemplo, un módulo
    /// que solo llama a un servicio externo).
    pub papel: Option<&'static str>,
    /// Ids de `externos::registro()` (Task 4) que esta herramienta puede
    /// usar. Vacío si no sale nunca a la red.
    pub externos_opcionales: &'static [&'static str],
    /// Si `true`, esta herramienta puede pasar sus resultados por el auditor
    /// (Task 5) cuando haya una calibración vigente.
    pub admite_auditor: bool,
}

pub struct Herramienta {
    pub id: &'static str,
    pub nombre: &'static str,
    pub tipos: &'static [&'static str],
    pub resultado: TipoResultado,
    pub requisitos: RequisitosHerramienta,
}
```

- [ ] **Paso 2: registrar `geolocalizar` con sus requisitos y añadir `eco`**

```rust
pub fn registro() -> &'static [Herramienta] {
    &[
        Herramienta {
            id: "geolocalizar",
            nombre: "Geolocalización",
            tipos: &["imagen"],
            resultado: TipoResultado::GEO,
            requisitos: RequisitosHerramienta {
                nivel_minimo: "mini",
                papel: None, // usa `Nivel.recuperacion`/`geometricos`, no un papel de herramienta
                externos_opcionales: &[],
                admite_auditor: false,
            },
        },
        // Herramienta de desarrollo: ejercita el contrato de worker de
        // herramientas (Task 3) y el auditor (Task 5) sin ser una
        // herramienta real de cara al investigador. Solo se registra fuera
        // de `cfg(release_lumi)` -- ver Task 8, donde `main.rs` decide qué
        // build la incluye.
        #[cfg(debug_assertions)]
        Herramienta {
            id: "eco",
            nombre: "Eco (desarrollo)",
            tipos: &["imagen"],
            resultado: TipoResultado { coordenadas: false, pista_region: true, fuente_derivada: false },
            requisitos: RequisitosHerramienta {
                nivel_minimo: "mini",
                papel: Some("eco"),
                externos_opcionales: &["eco_externo"],
                admite_auditor: true,
            },
        },
    ]
}

pub fn por_id(id: &str) -> Option<&'static Herramienta> {
    registro().iter().find(|h| h.id == id)
}
```

- [ ] **Paso 3: la matriz de capacidades**

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "estado", rename_all = "snake_case")]
pub enum EstadoCapacidad {
    Disponible,
    NoInstalado { falta: String },
    SinVram { necesita_mb: u64, libre_mb: u64 },
    SinServicio { servicio: String },
    Deshabilitado { motivo: String },
    NoCompatible { tipo: String },
}

/// Única función que decide si una herramienta se puede lanzar. La usan
/// tanto `POST /v1/cases/:id/sources` (para rechazar antes de encolar) como
/// `GET /v1/capacidades` (para que la interfaz explique el motivo). Nunca se
/// duplica esta lógica en el cliente.
pub fn capacidad_de(app: &crate::App, herramienta_id: &str, tipo: &str, nivel: &str) -> EstadoCapacidad {
    let Some(h) = por_id(herramienta_id) else {
        return EstadoCapacidad::NoCompatible { tipo: tipo.into() };
    };
    if !h.tipos.contains(&tipo) {
        return EstadoCapacidad::NoCompatible { tipo: tipo.into() };
    }
    if crate::modelos::orden_nivel(nivel) < crate::modelos::orden_nivel(h.requisitos.nivel_minimo) {
        return EstadoCapacidad::Deshabilitado {
            motivo: format!("{} necesita al menos el nivel {}", h.nombre, h.requisitos.nivel_minimo),
        };
    }
    if let Some(papel) = h.requisitos.papel {
        match crate::modelos::modelos_del_papel(app, nivel, papel) {
            Ok(ids) if !ids.is_empty() => {
                if let Some(falta) = crate::modelos::primero_no_instalado(app, &ids) {
                    return EstadoCapacidad::NoInstalado { falta };
                }
            }
            _ => return EstadoCapacidad::NoInstalado { falta: format!("papel «{papel}» sin modelo en el nivel {nivel}") },
        }
    }
    EstadoCapacidad::Disponible
}
```

- [ ] **Paso 4: test de la matriz**

```rust
#[cfg(test)]
mod tests_capacidad {
    use super::*;

    #[test]
    fn tipo_no_admitido_es_no_compatible() {
        let app = crate::test_support::app_de_prueba();
        let est = capacidad_de(&app, "geolocalizar", "email", "mini");
        assert!(matches!(est, EstadoCapacidad::NoCompatible { .. }));
    }

    #[test]
    fn nivel_por_debajo_del_minimo_esta_deshabilitado() {
        let app = crate::test_support::app_de_prueba();
        // Requiere ajustar el registro de prueba: ver Task 2, `eco` con
        // `nivel_minimo: "pro"` en un registro de test si "mini" ya cumple
        // en el registro real. Si `eco` no está compilado (release), usa
        // "geolocalizar" contra un nivel inexistente:
        let est = capacidad_de(&app, "geolocalizar", "imagen", "no_existe");
        assert!(matches!(est, EstadoCapacidad::Deshabilitado { .. }) || matches!(est, EstadoCapacidad::NoInstalado { .. }));
    }
}
```

Si `crate::test_support::app_de_prueba()` no existe todavía, créalo como una función mínima
que construye un `App` de pruebas reutilizando lo que ya usan los tests existentes de
`crates/lumid/src/routes/access.rs` u otro módulo con `mod tests` — copia su patrón exacto de
construcción de `App` en memoria (SQLite `:memory:`) en vez de inventar uno nuevo.

- [ ] **Paso 5: `cargo test -p lumid fuentes::`**

Expected: los dos tests nuevos pasan (o fallan de forma legible si `app_de_prueba` aún no
existe — en ese caso complétalo primero con el patrón que ya usa el resto del crate).

- [ ] **Paso 6: commit**

```bash
git add crates/lumid/src/fuentes.rs
git commit -m "feat(darkroom-infra): registro de herramientas con matriz de capacidades

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Niveles con papeles por herramienta y el gestor de VRAM

**Files:**
- Modify: `crates/lumi-index/src/niveles.rs`
- Create: `crates/lumid/src/modelos.rs`
- Modify: `crates/lumid/src/queue/mod.rs` (registrar `GestorModelos` en `Queue`)
- Modify: `crates/lumid/src/main.rs` (si construye `Queue` con campos nombrados)
- Test: `crates/lumid/src/modelos.rs`, `mod tests`

**Interfaces:**
- Consumes: `Herramienta`, `RequisitosHerramienta` de Task 1.
- Produces: `pub fn orden_nivel(id: &str) -> u8`, `pub fn modelos_del_papel(app: &App, nivel:
  &str, papel: &str) -> anyhow::Result<Vec<String>>`, `pub fn primero_no_instalado(app: &App,
  ids: &[String]) -> Option<String>`, `pub struct GestorModelos`, `pub struct
  ReservaModelo` (RAII: liberar al hacer `Drop`), `pub fn reservar(&self, gpu: usize, modelo:
  &str, mb: u64) -> Result<ReservaModelo, EstadoCapacidad>`.

- [ ] **Paso 1: `Nivel.herramientas` en `lumi-index`**

En `crates/lumi-index/src/niveles.rs`, añade el campo con `#[serde(default)]` para que los
JSON de `registros/niveles/*.json` que ya existen sigan siendo válidos sin tocarlos:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Nivel {
    pub id: String,
    pub nombre: String,
    pub recuperacion: Vec<String>,
    pub geometricos: Vec<String>,
    /// Papel de herramienta (p.ej. "eco", más adelante "auditor", "alpr",
    /// "especies"...) a la lista de ids de `registros/modelos/*.json` que
    /// este nivel usa para ese papel. Vacío en los tres niveles hoy: ninguna
    /// herramienta de este plan tiene modelos reales que instalar.
    #[serde(default)]
    pub herramientas: std::collections::HashMap<String, Vec<String>>,
    pub cae_a: Option<String>,
}
```

- [ ] **Paso 2: test de deserialización retrocompatible**

Añade en el mismo fichero, dentro de `#[cfg(test)] mod tests` (créalo si no existe):

```rust
#[test]
fn nivel_sin_campo_herramientas_deserializa_con_mapa_vacio() {
    let n: Nivel = serde_json::from_str(
        r#"{"id":"mini","nombre":"Lumi Mini","recuperacion":["cosplace"],"geometricos":["tiny-roma"],"cae_a":null}"#,
    ).unwrap();
    assert!(n.herramientas.is_empty());
}
```

- [ ] **Paso 3: `cargo test -p lumi-index` — verificar que pasa**

- [ ] **Paso 4: `crates/lumid/src/modelos.rs` — orden de niveles y resolución de papel**

```rust
//! Objetivos de hardware por nivel (Darkroom 2, spec 3): Mini 8 GB VRAM /
//! 16 GB RAM; Pro 12 GB VRAM / 32 GB RAM; Vision 24 GB VRAM o más, o el LLM
//! enrutado a un proveedor externo. Este módulo no impone esos topes -- los
//! documenta como intención del registro -- pero sí es el único sitio que
//! sabe qué nivel es "más caro que" otro y qué modelos concretos usa una
//! herramienta en un nivel dado.

use crate::App;
use std::collections::HashMap;
use std::sync::Mutex;

pub const ORDEN_NIVELES: &[&str] = &["mini", "pro", "vision"];

pub fn orden_nivel(id: &str) -> u8 {
    ORDEN_NIVELES.iter().position(|n| *n == id).map(|p| p as u8).unwrap_or(0)
}

/// Los ids de modelo que el nivel usa para un papel de herramienta. Vacío si
/// el nivel no declara ese papel -- lo distingue de "declarado pero sin
/// modelos", que sería un registro mal escrito y también da vacío: quien
/// llama trata los dos casos igual (`NoInstalado`), que es lo correcto.
pub fn modelos_del_papel(app: &App, nivel: &str, papel: &str) -> anyhow::Result<Vec<String>> {
    let niveles = app.queue.niveles.lock().unwrap();
    Ok(lumi_index::niveles::resolver(&niveles, nivel, &instalados(app))
        .map(|n| n.herramientas.get(papel).cloned().unwrap_or_default())
        .unwrap_or_default())
}

fn instalados(app: &App) -> Vec<String> {
    app.queue.modelos.lock().unwrap().iter().filter(|m| !m.sha256.is_empty()).map(|m| m.id.clone()).collect()
}

pub fn primero_no_instalado(app: &App, ids: &[String]) -> Option<String> {
    let disponibles = instalados(app);
    ids.iter().find(|id| !disponibles.contains(id)).cloned()
}
```

- [ ] **Paso 5: el gestor de VRAM (LRU con reserva RAII)**

En el mismo fichero:

```rust
struct Residente {
    modelo: String,
    mb: u64,
    prestado: u32,
    ultimo_uso: std::time::Instant,
}

/// Un `GestorModelos` por GPU. No lanza procesos ni sabe de PyTorch: solo
/// lleva la cuenta de qué modelos dice tener cargados el worker y cuánta
/// VRAM le queda, para decidir ANTES de lanzar una tarea si hay hueco o si
/// hay que liberar algo. El worker real confirma la carga/descarga por su
/// propio canal de eventos (Task 3); si el worker y el gestor se
/// desincronizan, gana el worker -- este gestor es una reserva optimista,
/// no la verdad sobre la memoria de la GPU.
pub struct GestorModelos {
    presupuesto_mb: u64,
    residentes: Mutex<HashMap<String, Residente>>,
}

pub struct ReservaModelo<'g> {
    gestor: &'g GestorModelos,
    modelo: String,
}

impl<'g> Drop for ReservaModelo<'g> {
    fn drop(&mut self) {
        if let Some(r) = self.gestor.residentes.lock().unwrap().get_mut(&self.modelo) {
            r.prestado = r.prestado.saturating_sub(1);
            r.ultimo_uso = std::time::Instant::now();
        }
    }
}

impl GestorModelos {
    pub fn nuevo(presupuesto_mb: u64) -> Self {
        Self { presupuesto_mb, residentes: Mutex::new(HashMap::new()) }
    }

    /// Si el modelo ya está cargado, lo marca prestado y devuelve la reserva
    /// sin liberar nada. Si no, libera residentes no prestados por orden de
    /// último uso hasta que quepa, y si aun así no cabe, `Err`. NUNCA
    /// desaloja un modelo con `prestado > 0`: una tarea en curso no pierde
    /// su modelo por debajo.
    pub fn reservar(&self, modelo: &str, mb: u64) -> Result<ReservaModelo<'_>, crate::fuentes::EstadoCapacidad> {
        let mut mapa = self.residentes.lock().unwrap();
        if let Some(r) = mapa.get_mut(modelo) {
            r.prestado += 1;
            return Ok(ReservaModelo { gestor: self, modelo: modelo.to_string() });
        }
        let en_uso: u64 = mapa.values().map(|r| r.mb).sum();
        let mut libre = self.presupuesto_mb.saturating_sub(en_uso);
        if libre < mb {
            let mut candidatos: Vec<_> = mapa.iter().filter(|(_, r)| r.prestado == 0).map(|(k, r)| (k.clone(), r.mb, r.ultimo_uso)).collect();
            candidatos.sort_by_key(|(_, _, ultimo)| *ultimo);
            for (id, mb_liberado, _) in candidatos {
                if libre >= mb { break; }
                mapa.remove(&id);
                libre += mb_liberado;
            }
        }
        if libre < mb {
            return Err(crate::fuentes::EstadoCapacidad::SinVram { necesita_mb: mb, libre_mb: libre });
        }
        mapa.insert(modelo.to_string(), Residente { modelo: modelo.to_string(), mb, prestado: 1, ultimo_uso: std::time::Instant::now() });
        Ok(ReservaModelo { gestor: self, modelo: modelo.to_string() })
    }

    pub fn confirmar_descargado(&self, modelo: &str) {
        self.residentes.lock().unwrap().remove(modelo);
    }
}
```

- [ ] **Paso 6: tests del gestor**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reutiliza_un_modelo_ya_cargado_sin_descargar_nada() {
        let g = GestorModelos::nuevo(1000);
        let _r1 = g.reservar("a", 400).unwrap();
        let _r2 = g.reservar("a", 400).unwrap();
        assert_eq!(g.residentes.lock().unwrap().len(), 1);
    }

    #[test]
    fn descarga_el_menos_usado_para_hacer_hueco() {
        let g = GestorModelos::nuevo(500);
        {
            let _r1 = g.reservar("viejo", 300).unwrap();
        } // se libera el préstamo, "viejo" queda residente sin prestar
        let _r2 = g.reservar("nuevo", 300).unwrap();
        let mapa = g.residentes.lock().unwrap();
        assert!(!mapa.contains_key("viejo"));
        assert!(mapa.contains_key("nuevo"));
    }

    #[test]
    fn no_descarga_un_modelo_prestado_aunque_falte_espacio() {
        let g = GestorModelos::nuevo(500);
        let _r1 = g.reservar("en_uso", 400).unwrap(); // sigue vivo, prestado > 0
        let err = g.reservar("otro", 300);
        assert!(matches!(err, Err(crate::fuentes::EstadoCapacidad::SinVram { .. })));
    }

    #[test]
    fn orden_de_niveles_es_creciente() {
        assert!(orden_nivel("mini") < orden_nivel("pro"));
        assert!(orden_nivel("pro") < orden_nivel("vision"));
    }
}
```

- [ ] **Paso 7: `cargo test -p lumid modelos::` — verificar que los cuatro pasan**

- [ ] **Paso 8: registrar el módulo y el gestor en `App`**

En `crates/lumid/src/main.rs`, añade `mod modelos;` junto a los demás `mod` de nivel de
crate, y en la construcción de `Queue` (busca `niveles: Mutex::new(...)` en
`crates/lumid/src/queue/mod.rs` para localizar el struct literal) añade el campo:

```rust
pub(crate) gestor_modelos: modelos::GestorModelos,
```

y en su construcción:

```rust
gestor_modelos: modelos::GestorModelos::nuevo(gpu_mb_total),
```

donde `gpu_mb_total` sale de `app.gpus.first().map(|g| g.vram_mb).unwrap_or(0)` (usa el campo
real de `GpuInfo` — revísalo en `crates/lumid/src/hardware.rs` si el nombre difiere; adapta
sin cambiar el resto del plan).

- [ ] **Paso 9: commit**

```bash
git add crates/lumi-index/src/niveles.rs crates/lumid/src/modelos.rs crates/lumid/src/main.rs crates/lumid/src/queue/mod.rs
git commit -m "feat(darkroom-infra): niveles con papeles por herramienta y gestor de VRAM LRU

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Contrato de worker para herramientas

**Files:**
- Modify: `crates/lumi-proto/src/worker.rs`
- Create: `crates/lumid/src/queue/herramienta_worker.rs`
- Modify: `crates/lumid/src/queue/mod.rs` (mod + wiring mínimo de despacho)
- Create: `workers/lumi_herramienta_eco.py`
- Test: `crates/lumi-proto/src/worker.rs`, `mod tests`

**Interfaces:**
- Consumes: `GestorModelos::reservar` (Task 2), `bitacora::anotar` (spec 2).
- Produces: `lumi_proto::worker::TareaHerramienta`, `lumi_proto::worker::MsgHerramienta`,
  `crate::queue::herramienta_worker::Evento`, `pub async fn lanzar(app: App, tarea:
  TareaHerramienta) -> tokio::sync::mpsc::UnboundedReceiver<Evento>`. Task 6 (pistas) y las
  herramientas futuras consumen `Evento::ResultadoHerramienta`.

- [ ] **Paso 1: el contrato en `lumi-proto`**

Añade a `crates/lumi-proto/src/worker.rs`, junto a `Job`/`Msg` ya existentes (no los toques:
son el contrato de embebido, este es uno nuevo y separado):

```rust
/// La tarea que `lumid` manda a un worker de HERRAMIENTA (distinto del
/// worker de embebido de `Job`/`Msg`, que solo geolocaliza). Autocontenida:
/// el worker no vuelve a preguntar nada por otro canal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TareaHerramienta {
    pub tipo: String, // siempre "tarea_herramienta"
    pub task_id: i64, // el id de `resultados`... no, el id de la EJECUCIÓN: `analyses.id`
    pub herramienta: String,
    pub fuente: FuenteTarea,
    pub nivel: String,
    pub modelos: Vec<String>,
    #[serde(default)]
    pub auditor: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FuenteTarea {
    pub id: i64,
    pub tipo: String,
    pub sha256: Option<String>,
    pub ruta: Option<String>,
    pub valor: Option<String>,
}

impl TareaHerramienta {
    pub fn nueva(task_id: i64, herramienta: String, fuente: FuenteTarea, nivel: String, modelos: Vec<String>) -> Self {
        Self { tipo: "tarea_herramienta".into(), task_id, herramienta, fuente, nivel, modelos, auditor: false }
    }
}

/// Lo que el worker de herramienta contesta por `stdout`. Un resultado no
/// lleva `revision`: la decide el investigador, nunca el worker (spec 3 §4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum MsgHerramienta {
    Listo { dispositivo: String },
    Progreso { task_id: i64, fase: String },
    Resultado {
        task_id: i64,
        orden: u32,
        titulo: String,
        puntuacion: Option<f64>,
        lat: Option<f64>,
        lng: Option<f64>,
        radio_m: Option<f64>,
        datos: serde_json::Value,
    },
    PistaRegion {
        task_id: i64,
        resultado_orden: u32,
        motivo: String,
        confianza: f64,
        /// GeoJSON de la geometría (polígono o punto+radio), tal cual la
        /// dibuja `MapCanvas` en el spec 2.
        geometria: serde_json::Value,
    },
    Fallo { task_id: i64, motivo: String },
}
```

- [ ] **Paso 2: test de serialización del contrato**

```rust
#[cfg(test)]
mod tests_herramienta {
    use super::*;

    #[test]
    fn tarea_herramienta_redondea_por_json() {
        let t = TareaHerramienta::nueva(
            7, "eco".into(),
            FuenteTarea { id: 1, tipo: "imagen".into(), sha256: Some("abc".into()), ruta: Some("/x.jpg".into()), valor: None },
            "mini".into(), vec!["m1".into()],
        );
        let s = serde_json::to_string(&t).unwrap();
        let back: TareaHerramienta = serde_json::from_str(&s).unwrap();
        assert_eq!(t, back);
    }

    #[test]
    fn resultado_sin_coordenadas_deserializa() {
        let s = r#"{"tipo":"resultado","task_id":7,"orden":1,"titulo":"x","puntuacion":null,"lat":null,"lng":null,"radio_m":null,"datos":{}}"#;
        let m: MsgHerramienta = serde_json::from_str(s).unwrap();
        assert!(matches!(m, MsgHerramienta::Resultado { .. }));
    }
}
```

- [ ] **Paso 3: `cargo test -p lumi-proto` — verificar que pasan**

- [ ] **Paso 4: el proceso hijo, calcado del patrón de `queue/worker.rs`**

Crea `crates/lumid/src/queue/herramienta_worker.rs`. Reutiliza literalmente el patrón de
lectura de líneas de `crates/lumid/src/queue/worker.rs` (child process, `BufReader` sobre
`stdout`, un canal `mpsc` de eventos, `stdin` con una tarea por línea) — ábrelo primero y
copia su estructura de spawn/lectura, cambiando solo los tipos:

```rust
//! El mismo primitivo de proceso hijo que `worker.rs`, para tareas de
//! HERRAMIENTA en vez de embebido. Un proceso por tarea (no de vida larga
//! como el worker de embebido) porque las herramientas son heterogéneas y no
//! vale la pena mantener N procesos calientes para N herramientas de uso
//! esporádico; el que sí se mantiene caliente es el servicio de LLM/VLM
//! compartido (Task 5), que es la pieza cara de verdad.

use anyhow::Result;
use lumi_proto::worker::{MsgHerramienta, TareaHerramienta};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::{self, UnboundedReceiver};

#[derive(Debug, Clone)]
pub enum Evento {
    Progreso { task_id: i64, fase: String },
    Resultado(lumi_proto::worker::MsgHerramienta),
    Fallo { task_id: i64, motivo: String },
    Terminado,
}

/// Lanza el script de la herramienta (`workers/lumi_herramienta_<id>.py`),
/// le manda la tarea por `stdin` en una línea de JSON, y retransmite cada
/// línea de `stdout` como `Evento`. El proceso termina solo al cerrar su
/// `stdout` (fin de tarea); no hay bucle de vida larga aquí.
pub async fn lanzar(script: std::path::PathBuf, tarea: TareaHerramienta) -> Result<UnboundedReceiver<Evento>> {
    let (tx, rx) = mpsc::unbounded_channel();
    let mut child = Command::new("python3")
        .arg(&script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let mut stdin = child.stdin.take().expect("stdin piped");
    let linea = serde_json::to_string(&tarea)? + "\n";
    stdin.write_all(linea.as_bytes()).await?;
    drop(stdin);

    let stdout = child.stdout.take().expect("stdout piped");
    let task_id = tarea.task_id;
    tokio::spawn(async move {
        let mut lector = BufReader::new(stdout).lines();
        loop {
            match lector.next_line().await {
                Ok(Some(linea)) => {
                    match serde_json::from_str::<MsgHerramienta>(&linea) {
                        Ok(MsgHerramienta::Progreso { fase, .. }) => { let _ = tx.send(Evento::Progreso { task_id, fase }); }
                        Ok(MsgHerramienta::Fallo { motivo, .. }) => { let _ = tx.send(Evento::Fallo { task_id, motivo }); }
                        Ok(otro) => { let _ = tx.send(Evento::Resultado(otro)); }
                        Err(e) => { let _ = tx.send(Evento::Fallo { task_id, motivo: format!("línea no entendida: {e}") }); }
                    }
                }
                Ok(None) => { let _ = tx.send(Evento::Terminado); break; }
                Err(e) => { let _ = tx.send(Evento::Fallo { task_id, motivo: e.to_string() }); break; }
            }
        }
        let _ = child.wait().await;
    });
    Ok(rx)
}
```

- [ ] **Paso 5: el worker de desarrollo `eco`**

Crea `workers/lumi_herramienta_eco.py`, ejecutable como los demás scripts de `workers/`:

```python
#!/usr/bin/env python3
"""Worker de desarrollo del spec 3 de Darkroom 2: no analiza nada de verdad.
Lee una TareaHerramienta por stdin, contesta un resultado fijo y una pista
de región fija, para ejercitar el contrato de extremo a extremo sin
depender de ningún modelo real. Solo se lanza cuando `herramienta == "eco"`,
que en producción no está registrada (ver `fuentes.rs`, `cfg(debug_assertions)`).
"""
import json
import sys

def main():
    linea = sys.stdin.readline()
    tarea = json.loads(linea)
    task_id = tarea["task_id"]
    print(json.dumps({"tipo": "listo", "dispositivo": "cpu"}), flush=True)
    print(json.dumps({
        "tipo": "resultado", "task_id": task_id, "orden": 1, "titulo": "Resultado de eco",
        "puntuacion": 0.5, "lat": None, "lng": None, "radio_m": None, "datos": {"eco": True},
    }), flush=True)
    print(json.dumps({
        "tipo": "pistaregion", "task_id": task_id, "resultado_orden": 1,
        "motivo": "pista de prueba", "confianza": 0.4,
        "geometria": {"type": "Point", "coordinates": [0, 0]},
    }), flush=True)

if __name__ == "__main__":
    main()
```

- [ ] **Paso 6: wiring mínimo en `queue/mod.rs`**

Añade una función que la Task 6 (pistas) y las herramientas futuras invocarán para lanzar y
consumir una tarea de herramienta — sin conectarla todavía a ninguna ruta HTTP real (eso
llega con las herramientas concretas, fuera de este plan). En `crates/lumid/src/queue/mod.rs`,
añade:

```rust
pub async fn ejecutar_herramienta(app: App, tarea: lumi_proto::worker::TareaHerramienta) -> anyhow::Result<()> {
    let script = crate::assets::ruta(&format!("workers/lumi_herramienta_{}.py", tarea.herramienta));
    let mut rx = crate::queue::herramienta_worker::lanzar(script, tarea.clone()).await?;
    while let Some(ev) = rx.recv().await {
        match ev {
            crate::queue::herramienta_worker::Evento::Resultado(msg) => {
                crate::herramientas_resultados::persistir(&app, tarea.task_id, msg)?;
            }
            crate::queue::herramienta_worker::Evento::Fallo { motivo, .. } => {
                tracing::warn!(herramienta = %tarea.herramienta, %motivo, "tarea de herramienta falló");
            }
            _ => {}
        }
    }
    Ok(())
}
```

Deja `crate::herramientas_resultados::persistir` como una función mínima en un nuevo módulo
`crates/lumid/src/herramientas_resultados.rs` que solo inserte en `resultados` (spec 2) y en
`pistas_region` (Task 6 lo completa; aquí basta con que compile):

```rust
//! Persiste lo que un worker de herramienta contestó. Task 6 (pistas de
//! región) añade la rama de `PistaRegion`; aquí solo se deja el esqueleto
//! para que `queue::ejecutar_herramienta` compile.

use crate::App;
use lumi_proto::worker::MsgHerramienta;

pub fn persistir(app: &App, task_id: i64, msg: MsgHerramienta) -> anyhow::Result<()> {
    if let MsgHerramienta::Resultado { orden, titulo, puntuacion, lat, lng, radio_m, datos, .. } = msg {
        let conn = app.store.conn();
        conn.execute(
            "INSERT INTO resultados (source_id, orden, titulo, puntuacion, lat, lng, radio_m, revision, payload, creado_en)
             SELECT s.id, ?2, ?3, ?4, ?5, ?6, ?7, 'sin_revisar', ?8, strftime('%s','now')
             FROM sources s JOIN analyses a ON a.source_id = s.id WHERE a.id = ?1",
            rusqlite::params![task_id, orden, titulo, puntuacion, lat, lng, radio_m, datos.to_string()],
        )?;
    }
    Ok(())
}
```

Añade `mod herramientas_resultados;` y `mod queue;` (si `herramienta_worker` no está ya
declarado) en `crates/lumid/src/main.rs`, y `pub mod herramienta_worker;` dentro de
`crates/lumid/src/queue/mod.rs`.

- [ ] **Paso 7: `cargo build -p lumid` — debe compilar limpio**

- [ ] **Paso 8: commit**

```bash
git add crates/lumi-proto/src/worker.rs crates/lumid/src/queue/herramienta_worker.rs crates/lumid/src/queue/mod.rs crates/lumid/src/herramientas_resultados.rs crates/lumid/src/main.rs workers/lumi_herramienta_eco.py
git commit -m "feat(darkroom-infra): contrato JSON-lines de worker para herramientas + worker eco de desarrollo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Adaptadores de servicios externos, con auditoría

**Files:**
- Create: `crates/lumid/src/externos.rs`
- Create: `crates/lumid/src/routes/externos.rs`
- Modify: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`
- Test: `crates/lumid/src/externos.rs`, `mod tests`

**Interfaces:**
- Consumes: `bitacora::anotar` (spec 2, firma exacta: revisa
  `crates/lumid/src/bitacora.rs` del spec 2 antes de escribir esta tarea y ajusta la llamada a
  su firma real si difiere del ejemplo de abajo).
- Produces: `pub trait AdaptadorExterno`, `pub fn registro() -> Vec<Box<dyn
  AdaptadorExterno>>`, `pub struct ConfigExterno`, `pub fn config_de(app: &App, id: &str) ->
  ConfigExterno`, `pub fn guardar_config(app: &App, id: &str, cfg: &ConfigExterno) ->
  anyhow::Result<()>`, `pub async fn enviar<T: DeserializeOwned>(app: &App, case_id: i64,
  user_id: i64, adaptador_id: &str, proposito: &str, campos: serde_json::Value, sha256_imagen:
  Option<&str>, llamada: impl FnOnce(&ConfigExterno) -> BoxFuture<'static,
  anyhow::Result<T>>) -> anyhow::Result<T>`.

- [ ] **Paso 1: el trait y la configuración vía `meta`**

```rust
//! Adaptadores a servicios externos. Cada uno declara su comportamiento;
//! ninguno hace HTTP fuera de `enviar()`, que es el único punto que también
//! escribe en la bitácora del caso. La configuración vive en `Store::meta`,
//! igual que `map_key` (ver `routes/map.rs`) -- sin tabla ni cifrado nuevos,
//! porque el precedente ya existente en el repo trata así una credencial de
//! proveedor guardada server-side y nunca expuesta al cliente.

use crate::App;
use serde::{Deserialize, Serialize};

pub trait AdaptadorExterno: Send + Sync {
    fn id(&self) -> &'static str;
    fn nombre(&self) -> &'static str;
    fn proveedor(&self) -> &'static str;
    /// Texto exacto que ve el investigador antes de lanzar: "Se enviará
    /// <esto> a <proveedor>". No es un enum: cada adaptador conoce su propio
    /// dato mejor que un tipo genérico.
    fn descripcion_envio(&self) -> &'static str;
    fn activo(&self) -> bool;
    /// Si `activo()` es `true`, el texto de advertencia obligatorio que se
    /// muestra antes de cada ejecución (spec 3 §3.2). `None` si es pasivo.
    fn advertencia_activo(&self) -> Option<&'static str> { None }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConfigExterno {
    pub habilitado: bool,
    pub clave: Option<String>,
    pub limite_por_minuto: Option<u32>,
    /// Solo relevante si el adaptador es activo: confirmación explícita y
    /// separada de `habilitado`, para que activar el servicio y aceptar que
    /// es activo sean dos clics, no uno.
    pub confirmado_activo: bool,
}

fn clave_meta(id: &str, campo: &str) -> String {
    format!("externo_{id}_{campo}")
}

pub fn config_de(app: &App, id: &str) -> ConfigExterno {
    ConfigExterno {
        habilitado: app.store.get_meta(&clave_meta(id, "habilitado")).as_deref() == Some("1"),
        clave: app.store.get_meta(&clave_meta(id, "clave")),
        limite_por_minuto: app.store.get_meta(&clave_meta(id, "limite")).and_then(|s| s.parse().ok()),
        confirmado_activo: app.store.get_meta(&clave_meta(id, "confirmado_activo")).as_deref() == Some("1"),
    }
}

pub fn guardar_config(app: &App, id: &str, cfg: &ConfigExterno) -> anyhow::Result<()> {
    app.store.set_meta(&clave_meta(id, "habilitado"), if cfg.habilitado { "1" } else { "0" })?;
    if let Some(c) = &cfg.clave { app.store.set_meta(&clave_meta(id, "clave"), c)?; }
    if let Some(l) = cfg.limite_por_minuto { app.store.set_meta(&clave_meta(id, "limite"), &l.to_string())?; }
    app.store.set_meta(&clave_meta(id, "confirmado_activo"), if cfg.confirmado_activo { "1" } else { "0" })?;
    Ok(())
}
```

- [ ] **Paso 2: el adaptador de desarrollo y el registro**

```rust
pub struct AdaptadorEco;
impl AdaptadorExterno for AdaptadorEco {
    fn id(&self) -> &'static str { "eco_externo" }
    fn nombre(&self) -> &'static str { "Servicio de eco (desarrollo)" }
    fn proveedor(&self) -> &'static str { "localhost" }
    fn descripcion_envio(&self) -> &'static str { "Se enviará el valor de la fuente a un servicio de prueba local." }
    fn activo(&self) -> bool { false }
}

#[cfg(debug_assertions)]
pub fn registro() -> Vec<Box<dyn AdaptadorExterno>> {
    vec![Box::new(AdaptadorEco)]
}
#[cfg(not(debug_assertions))]
pub fn registro() -> Vec<Box<dyn AdaptadorExterno>> {
    vec![]
}

pub fn por_id(id: &str) -> Option<Box<dyn AdaptadorExterno>> {
    registro().into_iter().find(|a| a.id() == id)
}
```

- [ ] **Paso 3: `enviar()`, que audita antes y después**

```rust
/// Envuelve toda llamada a un adaptador externo. Dos entradas de bitácora
/// por llamada, en la MISMA transacción lógica que el resto del caso (spec
/// 2, `bitacora::anotar`): una antes de llamar (qué se manda) y una después
/// (qué contestó, sin el cuerpo íntegro). Si el adaptador no está
/// habilitado, o es activo sin `confirmado_activo`, no se llama y se
/// devuelve error ANTES de tocar la red.
pub async fn enviar<T, F, Fut>(
    app: &App, case_id: i64, user_id: i64, adaptador_id: &str, proposito: &str,
    campos: serde_json::Value, sha256_imagen: Option<&str>, llamada: F,
) -> anyhow::Result<T>
where
    F: FnOnce(ConfigExterno) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<T>>,
    T: Serialize,
{
    let adaptador = por_id(adaptador_id).ok_or_else(|| anyhow::anyhow!("adaptador desconocido: {adaptador_id}"))?;
    let cfg = config_de(app, adaptador_id);
    if !cfg.habilitado {
        anyhow::bail!("el servicio «{}» no está habilitado por el administrador", adaptador.nombre());
    }
    if adaptador.activo() && !cfg.confirmado_activo {
        anyhow::bail!("el servicio «{}» es activo y necesita confirmación explícita del administrador", adaptador.nombre());
    }
    crate::bitacora::anotar(&app.store.conn(), case_id, Some(user_id), "externo.enviado", &serde_json::json!({
        "adaptador": adaptador_id, "proveedor": adaptador.proveedor(), "proposito": proposito,
        "campos": campos, "sha256_imagen": sha256_imagen,
    }))?;
    let inicio = std::time::Instant::now();
    let resultado = llamada(cfg).await;
    let duracion_ms = inicio.elapsed().as_millis() as u64;
    crate::bitacora::anotar(&app.store.conn(), case_id, Some(user_id), "externo.respondido", &serde_json::json!({
        "adaptador": adaptador_id, "ok": resultado.is_ok(), "duracion_ms": duracion_ms,
    }))?;
    resultado
}
```

Ajusta la firma de `bitacora::anotar` a la real del spec 2 si difiere (por ejemplo, si toma
`&Connection` en vez de un `MutexGuard`, o si el orden de argumentos es distinto) — el
contrato que importa para el resto del plan es: dos llamadas, una antes y una después, ambas
dentro de la bitácora del caso.

- [ ] **Paso 4: test de la política de envío**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn no_llama_si_el_servicio_no_esta_habilitado() {
        let app = crate::test_support::app_de_prueba();
        let r: anyhow::Result<()> = enviar(&app, 1, 1, "eco_externo", "prueba", serde_json::json!({}), None, |_cfg| async { Ok(()) }).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn dos_entradas_de_bitacora_por_una_llamada_exitosa() {
        let app = crate::test_support::app_de_prueba();
        guardar_config(&app, "eco_externo", &ConfigExterno { habilitado: true, ..Default::default() }).unwrap();
        let _: () = enviar(&app, 1, 1, "eco_externo", "prueba", serde_json::json!({}), None, |_cfg| async { Ok(()) }).await.unwrap();
        let entradas = crate::bitacora::verificar(&app.store.conn(), 1).unwrap().entradas;
        let n = entradas.iter().filter(|e| e.accion.starts_with("externo.")).count();
        assert_eq!(n, 2);
    }
}
```

Ajusta `crate::bitacora::verificar(...)` a la firma real del spec 2 (puede que devuelva
directamente `Vec<EntradaBitacora>` en vez de un struct con `.entradas`).

- [ ] **Paso 5: `cargo test -p lumid externos::` — verificar que pasan**

- [ ] **Paso 6: rutas de administración**

Crea `crates/lumid/src/routes/externos.rs`, siguiendo el patrón de `require_admin` +
`Fail`/`err` de `routes/calibracion.rs` (Task 1 de este plan ya te hizo leerlo):

```rust
use crate::externos::{config_de, guardar_config, registro, ConfigExterno};
use crate::routes::auth::{bearer, require_admin};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};

#[derive(serde::Serialize)]
pub struct AdaptadorVista {
    pub id: String,
    pub nombre: String,
    pub proveedor: String,
    pub descripcion_envio: String,
    pub activo: bool,
    pub config: ConfigExterno,
}

pub async fn listar(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<AdaptadorVista>>, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    Ok(Json(registro().into_iter().map(|a| AdaptadorVista {
        id: a.id().into(), nombre: a.nombre().into(), proveedor: a.proveedor().into(),
        descripcion_envio: a.descripcion_envio().into(), activo: a.activo(),
        config: config_de(&app, a.id()),
    }).collect()))
}

pub async fn guardar(State(app): State<App>, headers: HeaderMap, Path(id): Path<String>, Json(cfg): Json<ConfigExterno>) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    if crate::externos::por_id(&id).is_none() {
        return Err(err(StatusCode::NOT_FOUND, "adaptador desconocido"));
    }
    guardar_config(&app, &id, &cfg).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 7: registrar las rutas**

En `crates/lumid/src/routes/mod.rs`, añade `pub mod externos;`. En `crates/lumid/src/main.rs`,
en el bloque donde se construye el `Router` con `.route(...)`, añade junto a las rutas de
admin existentes:

```rust
.route("/v1/admin/externos", axum::routing::get(routes::externos::listar))
.route("/v1/admin/externos/:id", axum::routing::put(routes::externos::guardar))
```

- [ ] **Paso 8: `cargo build -p lumid` — debe compilar limpio**

- [ ] **Paso 9: commit**

```bash
git add crates/lumid/src/externos.rs crates/lumid/src/routes/externos.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat(darkroom-infra): adaptadores de servicios externos con auditoría en la bitácora

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Servicio de LLM/VLM compartido, enrutable y con calibración

**Files:**
- Create: `crates/lumid/src/auditor.rs`
- Create: `crates/lumid/src/routes/calibracion_ia.rs`
- Modify: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`, `crates/lumid/src/store.rs` (tabla `calibraciones_ia`)
- Test: `crates/lumid/src/auditor.rs`, `mod tests` (con `wiremock` como dev-dependency)

**Interfaces:**
- Consumes: `ConfigExterno`/`enviar` (Task 4, si el enrutado es externo), `GestorModelos`
  (Task 2, si el enrutado es local).
- Produces: `pub enum Enrutado`, `pub struct Veredicto`, `pub async fn auditar(app: &App,
  herramienta: &str, nivel: &str, contexto: serde_json::Value) -> anyhow::Result<Veredicto>`,
  `pub fn calibracion_vigente(app: &App, herramienta: &str) -> Option<Calibracion>`.

- [ ] **Paso 1: añadir `wiremock` como dev-dependency**

En `crates/lumid/Cargo.toml`, en `[dev-dependencies]` (créala si no existe):

```toml
[dev-dependencies]
wiremock = "0.6"
```

- [ ] **Paso 2: la tabla de calibraciones**

En `crates/lumid/src/store.rs`, en la lista de `CREATE TABLE IF NOT EXISTS` (junto a las
demás, siguiendo el mismo estilo), añade:

```sql
CREATE TABLE IF NOT EXISTS calibraciones_ia (
    id            INTEGER PRIMARY KEY,
    herramienta   TEXT NOT NULL,
    modelo        TEXT NOT NULL,
    version       TEXT NOT NULL,
    conjunto      TEXT NOT NULL,      -- identificador del conjunto etiquetado usado
    metricas_json TEXT NOT NULL,
    vigente       INTEGER NOT NULL DEFAULT 1,
    creado_en     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calibraciones_herramienta ON calibraciones_ia(herramienta, vigente);
```

- [ ] **Paso 3: el enrutado y el veredicto**

```rust
//! El servicio de VLM/LLM compartido: un único cliente, con salida
//! ESTRUCTURADA contra un esquema fijo, nunca texto libre. Cada herramienta
//! que lo usa (spec 3 §4.1) pide un veredicto, no una conversación. El
//! enrutado (local / OpenRouter / endpoint compatible con OpenAI) se decide
//! por modelo y por nivel -- lo que Darkroom 2 llama "enrutado de modelos".

use crate::App;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "veredicto", rename_all = "snake_case")]
pub enum Veredicto {
    Probable { motivo: String },
    NoConcluyente { motivo: String },
    ProbableFalsoPositivo { motivo: String },
    Abstencion { motivo: String },
}

#[derive(Debug, Clone)]
enum Enrutado {
    Local { papel: String },
    OpenAiCompatible { url: String, clave: Option<String>, modelo: String },
}

fn enrutado_de(app: &App, herramienta: &str, nivel: &str) -> Enrutado {
    let base = format!("auditor_ruta_{herramienta}_{nivel}");
    match app.store.get_meta(&base).as_deref() {
        Some("openrouter") => Enrutado::OpenAiCompatible {
            url: "https://openrouter.ai/api/v1/chat/completions".into(),
            clave: app.store.get_meta(&format!("{base}_clave")),
            modelo: app.store.get_meta(&format!("{base}_modelo")).unwrap_or_default(),
        },
        Some("compatible") => Enrutado::OpenAiCompatible {
            url: app.store.get_meta(&format!("{base}_url")).unwrap_or_default(),
            clave: app.store.get_meta(&format!("{base}_clave")),
            modelo: app.store.get_meta(&format!("{base}_modelo")).unwrap_or_default(),
        },
        _ => Enrutado::Local { papel: "auditor".into() },
    }
}

#[derive(Debug, Clone)]
pub struct Calibracion {
    pub modelo: String,
    pub version: String,
    pub metricas: serde_json::Value,
}

pub fn calibracion_vigente(app: &App, herramienta: &str) -> Option<Calibracion> {
    let conn = app.store.conn();
    conn.query_row(
        "SELECT modelo, version, metricas_json FROM calibraciones_ia WHERE herramienta = ?1 AND vigente = 1 ORDER BY id DESC LIMIT 1",
        [herramienta],
        |r| Ok(Calibracion {
            modelo: r.get(0)?, version: r.get(1)?,
            metricas: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
        }),
    ).ok()
}

/// Punto único de entrada. Si no hay calibración vigente para la
/// herramienta, ni siquiera se llama al modelo: se devuelve `Abstencion`
/// directamente, porque un auditor sin calibrar es indistinguible de uno
/// que miente con seguridad (spec 3 §4.2). `contexto` es lo que la
/// herramienta considera evidencia permitida -- este módulo no decide qué
/// meter ahí, solo lo reenvía.
pub async fn auditar(app: &App, herramienta: &str, nivel: &str, contexto: serde_json::Value) -> anyhow::Result<Veredicto> {
    let Some(_cal) = calibracion_vigente(app, herramienta) else {
        return Ok(Veredicto::Abstencion { motivo: "el auditor no tiene una calibración vigente para esta herramienta".into() });
    };
    match enrutado_de(app, herramienta, nivel) {
        Enrutado::Local { .. } => {
            // La invocación real de un worker local de VLM/LLM es una pieza
            // que trae su propio modelo instalable (fuera de este plan, que
            // no instala pesos). Mientras no haya un papel "auditor"
            // instalado, se abstiene explícitamente en vez de fingir.
            Ok(Veredicto::Abstencion { motivo: "sin modelo local de auditor instalado en este nivel".into() })
        }
        Enrutado::OpenAiCompatible { url, clave, modelo } => llamar_compatible(&url, clave.as_deref(), &modelo, contexto).await,
    }
}

async fn llamar_compatible(url: &str, clave: Option<&str>, modelo: &str, contexto: serde_json::Value) -> anyhow::Result<Veredicto> {
    let cliente = reqwest::Client::new();
    let mut req = cliente.post(url).json(&serde_json::json!({
        "model": modelo,
        "messages": [{"role": "user", "content": contexto.to_string()}],
        "response_format": {"type": "json_object"},
    }));
    if let Some(k) = clave { req = req.bearer_auth(k); }
    let resp = req.send().await?.error_for_status()?;
    let cuerpo: serde_json::Value = resp.json().await?;
    let texto = cuerpo["choices"][0]["message"]["content"].as_str().unwrap_or("{}");
    Ok(serde_json::from_str(texto).unwrap_or(Veredicto::NoConcluyente { motivo: "respuesta del modelo no ajustada al esquema".into() }))
}
```

- [ ] **Paso 4: tests con `wiremock`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn sin_calibracion_se_abstiene_sin_llamar_a_nadie() {
        let app = crate::test_support::app_de_prueba();
        let v = auditar(&app, "geolocalizar", "mini", serde_json::json!({})).await.unwrap();
        assert!(matches!(v, Veredicto::Abstencion { .. }));
    }

    #[tokio::test]
    async fn endpoint_compatible_devuelve_el_veredicto_del_json() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/chat"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "choices": [{"message": {"content": "{\"veredicto\":\"probable\",\"motivo\":\"coincide\"}"}}]
            })))
            .mount(&server).await;
        let v = llamar_compatible(&format!("{}/chat", server.uri()), None, "m", serde_json::json!({})).await.unwrap();
        assert!(matches!(v, Veredicto::Probable { .. }));
    }
}
```

- [ ] **Paso 5: `cargo test -p lumid auditor::` — verificar que pasan**

- [ ] **Paso 6: rutas de calibración**

Crea `crates/lumid/src/routes/calibracion_ia.rs` (nombre distinto de `routes/calibracion.rs`,
que es la calibración de verificadores geométricos y no se toca):

```rust
use crate::auditor::calibracion_vigente;
use crate::routes::auth::{bearer, require_admin};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};

#[derive(serde::Deserialize)]
pub struct NuevaCalibracionReq {
    pub herramienta: String,
    pub modelo: String,
    pub version: String,
    pub conjunto: String,
    pub metricas: serde_json::Value,
}

pub async fn crear(State(app): State<App>, headers: HeaderMap, Json(req): Json<NuevaCalibracionReq>) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    let conn = app.store.conn();
    conn.execute("UPDATE calibraciones_ia SET vigente = 0 WHERE herramienta = ?1", [&req.herramienta])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    conn.execute(
        "INSERT INTO calibraciones_ia (herramienta, modelo, version, conjunto, metricas_json, vigente, creado_en)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, strftime('%s','now'))",
        rusqlite::params![req.herramienta, req.modelo, req.version, req.conjunto, req.metricas.to_string()],
    ).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::CREATED)
}

#[derive(serde::Serialize)]
pub struct CalibracionVista { pub herramienta: String, pub modelo: String, pub version: String, pub metricas: serde_json::Value }

pub async fn obtener(State(app): State<App>, headers: HeaderMap, axum::extract::Path(herramienta): axum::extract::Path<String>) -> Result<Json<Option<CalibracionVista>>, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    Ok(Json(calibracion_vigente(&app, &herramienta).map(|c| CalibracionVista {
        herramienta: herramienta.clone(), modelo: c.modelo, version: c.version, metricas: c.metricas,
    })))
}
```

- [ ] **Paso 7: registrar y montar**

En `crates/lumid/src/routes/mod.rs`: `pub mod auditor` no (es de nivel de crate, no de
`routes`) — añade `mod auditor;` en `crates/lumid/src/main.rs` junto a `mod modelos;`, y
`pub mod calibracion_ia;` en `routes/mod.rs`. En `main.rs`, añade las rutas:

```rust
.route("/v1/admin/calibraciones", axum::routing::post(routes::calibracion_ia::crear))
.route("/v1/admin/calibraciones/:herramienta", axum::routing::get(routes::calibracion_ia::obtener))
```

- [ ] **Paso 8: `cargo build -p lumid` — debe compilar limpio**

- [ ] **Paso 9: commit**

```bash
git add crates/lumid/Cargo.toml crates/lumid/src/store.rs crates/lumid/src/auditor.rs crates/lumid/src/routes/calibracion_ia.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat(darkroom-infra): auditor IA enrutable con calibración obligatoria

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Pistas de región

**Files:**
- Modify: `crates/lumid/src/store.rs` (tabla `pistas_region`)
- Create: `crates/lumid/src/pistas.rs`
- Modify: `crates/lumid/src/herramientas_resultados.rs` (persistir `PistaRegion`)
- Create: `crates/lumid/src/routes/pistas.rs`
- Modify: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`
- Test: `crates/lumid/src/pistas.rs`, `mod tests`

**Interfaces:**
- Consumes: `bitacora::anotar` (spec 2), `resultados`/`analysis_hypotheses` (spec 2 y esquema
  existente).
- Produces: `pub struct PistaRegion`, `pub fn confirmar(app: &App, pista_id: i64, user_id:
  i64) -> anyhow::Result<Reponderacion>`, `pub fn descartar(app: &App, pista_id: i64, user_id:
  i64) -> anyhow::Result<()>`.

- [ ] **Paso 1: la tabla**

En `crates/lumid/src/store.rs`:

```sql
CREATE TABLE IF NOT EXISTS pistas_region (
    id             INTEGER PRIMARY KEY,
    resultado_id   INTEGER NOT NULL REFERENCES resultados(id),
    case_id        INTEGER NOT NULL REFERENCES cases(id),
    motivo         TEXT NOT NULL,
    confianza      REAL NOT NULL,
    geometria_json TEXT NOT NULL,
    revision       TEXT NOT NULL DEFAULT 'sin_revisar'
                   CHECK (revision IN ('sin_revisar','confirmado','descartado')),
    creado_en      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pistas_case ON pistas_region(case_id, revision);
```

- [ ] **Paso 2: geometría y contención**

```rust
//! Pistas de región: se muestran siempre, solo re-ponderan la
//! geolocalización del caso al confirmarse (spec 3 §4.3, índice de
//! Darkroom 2). La re-ponderación es multiplicativa y reversible: al
//! descartar una pista que ya se había confirmado, se recalcula desde cero
//! con las pistas confirmadas restantes -- nunca se "deshace" un factor
//! aislado, porque los factores no son necesariamente conmutativos si en el
//! futuro dejan de ser un simple múltiplo.

use crate::App;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PistaRegion {
    pub id: i64,
    pub resultado_id: i64,
    pub case_id: i64,
    pub motivo: String,
    pub confianza: f64,
    pub geometria: serde_json::Value,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CambioHipotesis { pub analysis_id: i64, pub orden: i64, pub factor: f64 }

#[derive(Debug, Clone, Serialize)]
pub struct Reponderacion { pub pista_id: i64, pub cambios: Vec<CambioHipotesis> }

/// Punto dentro de un círculo (aproximación esférica simple, suficiente para
/// una pista de "esta zona" y no un cálculo geodésico de precisión). La
/// geometría hoy es siempre `{"type":"Point","coordinates":[lng,lat]}` con
/// un radio implícito en metros guardado aparte en `confianza`... NO: el
/// radio va dentro de la geometría, `confianza` es un [0,1]. Ver Task 3: el
/// worker manda `geometria` como GeoJSON puro; si es un punto, esta función
/// asume un radio fijo de referencia razonable para pistas de tipo "punto",
/// y si es un polígono, usa un test punto-en-polígono simple (ray casting).
fn dentro_de(geometria: &serde_json::Value, lat: f64, lng: f64) -> bool {
    match geometria.get("type").and_then(|t| t.as_str()) {
        Some("Point") => {
            let Some(coords) = geometria["coordinates"].as_array() else { return false };
            let (glng, glat) = (coords[0].as_f64().unwrap_or(0.0), coords[1].as_f64().unwrap_or(0.0));
            // radio de referencia de 200 km para una pista puntual sin polígono explícito
            let d = ((lat - glat).powi(2) + (lng - glng).powi(2)).sqrt() * 111.0;
            d <= 200.0
        }
        Some("Polygon") => {
            let Some(anillo) = geometria["coordinates"][0].as_array() else { return false };
            let pts: Vec<(f64, f64)> = anillo.iter().filter_map(|p| {
                let a = p.as_array()?; Some((a[0].as_f64()?, a[1].as_f64()?))
            }).collect();
            ray_casting(&pts, lng, lat)
        }
        _ => false,
    }
}

fn ray_casting(poligono: &[(f64, f64)], x: f64, y: f64) -> bool {
    let mut dentro = false;
    let n = poligono.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poligono[i];
        let (xj, yj) = poligono[j];
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            dentro = !dentro;
        }
        j = i;
    }
    dentro
}

pub fn confirmar(app: &App, pista_id: i64, user_id: i64) -> anyhow::Result<Reponderacion> {
    let conn = app.store.conn();
    conn.execute("UPDATE pistas_region SET revision = 'confirmado' WHERE id = ?1", [pista_id])?;
    let (case_id, geometria, confianza): (i64, String, f64) = conn.query_row(
        "SELECT case_id, geometria_json, confianza FROM pistas_region WHERE id = ?1", [pista_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let geometria: serde_json::Value = serde_json::from_str(&geometria)?;
    let mut stmt = conn.prepare(
        "SELECT ah.analysis_id, ah.orden, ah.lat, ah.lng, ah.peso
         FROM analysis_hypotheses ah JOIN analyses a ON a.id = ah.analysis_id
         JOIN sources s ON s.id = a.source_id WHERE s.case_id = ?1",
    )?;
    let mut cambios = Vec::new();
    let filas = stmt.query_map([case_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?)))?;
    for fila in filas {
        let (analysis_id, orden, lat, lng) = fila?;
        let factor = if dentro_de(&geometria, lat, lng) { 1.0 + confianza } else { 1.0 - confianza * 0.5 };
        conn.execute("UPDATE analysis_hypotheses SET peso = peso * ?1 WHERE analysis_id = ?2 AND orden = ?3", rusqlite::params![factor, analysis_id, orden])?;
        cambios.push(CambioHipotesis { analysis_id, orden, factor });
    }
    crate::bitacora::anotar(&conn, case_id, Some(user_id), "pista.confirmada", &serde_json::json!({ "pista_id": pista_id, "cambios": cambios }))?;
    Ok(Reponderacion { pista_id, cambios })
}

pub fn descartar(app: &App, pista_id: i64, user_id: i64) -> anyhow::Result<()> {
    let conn = app.store.conn();
    let case_id: i64 = conn.query_row("SELECT case_id FROM pistas_region WHERE id = ?1", [pista_id], |r| r.get(0))?;
    conn.execute("UPDATE pistas_region SET revision = 'descartado' WHERE id = ?1", [pista_id])?;
    crate::bitacora::anotar(&conn, case_id, Some(user_id), "pista.descartada", &serde_json::json!({ "pista_id": pista_id }))?;
    Ok(())
}
```

- [ ] **Paso 3: tests de contención y de no-reponderación previa**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn punto_dentro_del_radio_de_referencia() {
        let g = serde_json::json!({"type": "Point", "coordinates": [-3.70, 40.41]});
        assert!(dentro_de(&g, 40.42, -3.71));
    }

    #[test]
    fn punto_fuera_del_radio_de_referencia() {
        let g = serde_json::json!({"type": "Point", "coordinates": [-3.70, 40.41]});
        assert!(!dentro_de(&g, 10.0, 10.0));
    }

    #[test]
    fn poligono_simple_contiene_su_centro() {
        let g = serde_json::json!({"type": "Polygon", "coordinates": [[[0.0,0.0],[0.0,2.0],[2.0,2.0],[2.0,0.0],[0.0,0.0]]]});
        assert!(dentro_de(&g, 1.0, 1.0));
        assert!(!dentro_de(&g, 5.0, 5.0));
    }
}
```

- [ ] **Paso 4: `cargo test -p lumid pistas::` — verificar que pasan**

- [ ] **Paso 5: completar `herramientas_resultados::persistir` con la rama de pistas**

En `crates/lumid/src/herramientas_resultados.rs` (creado en Task 3), añade:

```rust
if let MsgHerramienta::PistaRegion { task_id, motivo, confianza, geometria, .. } = msg {
    let conn = app.store.conn();
    conn.execute(
        "INSERT INTO pistas_region (resultado_id, case_id, motivo, confianza, geometria_json, revision, creado_en)
         SELECT r.id, s.case_id, ?2, ?3, ?4, 'sin_revisar', strftime('%s','now')
         FROM resultados r JOIN sources s ON s.id = r.source_id
         JOIN analyses a ON a.source_id = s.id WHERE a.id = ?1
         ORDER BY r.id DESC LIMIT 1",
        rusqlite::params![task_id, motivo, confianza, geometria.to_string()],
    )?;
}
```

(Cambia el `if let` inicial del fichero por un `match` que cubra ambas variantes, manteniendo
el bloque de `Resultado` ya escrito en Task 3.)

- [ ] **Paso 6: la ruta**

Crea `crates/lumid/src/routes/pistas.rs`:

```rust
use crate::pistas::{confirmar, descartar};
use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};

#[derive(serde::Deserialize)]
pub struct PatchPistaReq { pub revision: String }

pub async fn patch(State(app): State<App>, headers: HeaderMap, Path(id): Path<i64>, Json(req): Json<PatchPistaReq>) -> Result<StatusCode, Fail> {
    let (_uid, user_id) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    match req.revision.as_str() {
        "confirmado" => { confirmar(&app, id, user_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?; }
        "descartado" => { descartar(&app, id, user_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?; }
        _ => return Err(err(StatusCode::BAD_REQUEST, "revision debe ser confirmado o descartado")),
    }
    Ok(StatusCode::NO_CONTENT)
}
```

Ajusta `require_session` a la función real de autenticación de sesión que uses en otras rutas
de escritura de caso (revisa `routes/cases.rs` del spec 2 para el nombre exacto y su tupla de
retorno) — el contrato que importa es obtener `user_id` de la sesión autenticada.

- [ ] **Paso 7: registrar y montar**

`pub mod pistas;` en `routes/mod.rs`; en `main.rs`:

```rust
.route("/v1/pistas/:id", axum::routing::patch(routes::pistas::patch))
```

- [ ] **Paso 8: `cargo build -p lumid` — debe compilar limpio**

- [ ] **Paso 9: commit**

```bash
git add crates/lumid/src/store.rs crates/lumid/src/pistas.rs crates/lumid/src/herramientas_resultados.rs crates/lumid/src/routes/pistas.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat(darkroom-infra): pistas de región con re-ponderación al confirmar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `GET /v1/capacidades` y tipos de protocolo

**Files:**
- Modify: `crates/lumi-proto/src/api.rs`
- Create: `crates/lumid/src/routes/capacidades.rs`
- Modify: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Consumes: `fuentes::registro`, `fuentes::capacidad_de` (Task 1).
- Produces: `lumi_proto::api::CapacidadHerramienta`, endpoint `GET /v1/capacidades`, y su
  contraparte TypeScript `Capacidad` en `client/src/lib/api.ts`.

- [ ] **Paso 1: el tipo de protocolo**

En `crates/lumi-proto/src/api.rs`, añade junto a los demás tipos de respuesta:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacidadHerramienta {
    pub herramienta: String,
    pub nombre: String,
    pub tipos: Vec<String>,
    /// Por nivel: "mini" -> estado, "pro" -> estado, "vision" -> estado.
    pub por_nivel: std::collections::HashMap<String, serde_json::Value>,
}
```

- [ ] **Paso 2: la ruta**

```rust
use crate::fuentes;
use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::Fail;
use crate::App;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use lumi_proto::api::CapacidadHerramienta;

pub async fn listar(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<CapacidadHerramienta>>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    let salida = fuentes::registro().iter().map(|h| {
        let por_nivel = crate::modelos::ORDEN_NIVELES.iter().map(|nivel| {
            let tipo0 = h.tipos.first().copied().unwrap_or_default();
            (nivel.to_string(), serde_json::to_value(fuentes::capacidad_de(&app, h.id, tipo0, nivel)).unwrap())
        }).collect();
        CapacidadHerramienta { herramienta: h.id.into(), nombre: h.nombre.into(), tipos: h.tipos.iter().map(|s| s.to_string()).collect(), por_nivel }
    }).collect();
    Ok(Json(salida))
}
```

- [ ] **Paso 3: registrar y montar**

`pub mod capacidades;` en `routes/mod.rs`; en `main.rs`: `.route("/v1/capacidades",
axum::routing::get(routes::capacidades::listar))`.

- [ ] **Paso 4: `cargo build` en el workspace y `cargo test -p lumi-proto`**

Expected: compila limpio, los tests de `lumi-proto` (incluidos los de Task 3) pasan.

- [ ] **Paso 5: el tipo en el cliente**

En `client/src/lib/api.ts`, junto a los demás tipos y funciones de `fetch`, añade:

```ts
export type CapacidadHerramienta = {
  herramienta: string;
  nombre: string;
  tipos: string[];
  por_nivel: Record<string, { estado: string } & Record<string, unknown>>;
};

export async function obtenerCapacidades(): Promise<CapacidadHerramienta[]> {
  return apiGet("/v1/capacidades");
}
```

Usa el helper de fetch real (`apiGet`, `apiFetch`, o el nombre que ya use el archivo — revísalo
antes de escribir esta función y ajusta el nombre sin cambiar el resto).

- [ ] **Paso 6: `npx tsc -b --noEmit` en `client/` — debe compilar limpio**

- [ ] **Paso 7: commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/capacidades.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs client/src/lib/api.ts
git commit -m "feat(darkroom-infra): endpoint de capacidades para la matriz de herramientas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Panel de administración — servicios externos y calibraciones

**Files:**
- Create: `client/src/admin/ServiciosExternosView.tsx`
- Create: `client/src/admin/AuditorView.tsx`
- Modify: `client/src/admin/Sidebar.tsx`, `client/src/admin/AdminPanel.tsx`
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Consumes: `GET/PUT /v1/admin/externos*`, `GET/POST /v1/admin/calibraciones*` (Tasks 4 y 5).
- Produces: dos vistas de admin nuevas, enlazadas desde la barra lateral.

- [ ] **Paso 1: tipos y llamadas en `api.ts`**

```ts
export type ConfigExterno = { habilitado: boolean; clave: string | null; limite_por_minuto: number | null; confirmado_activo: boolean };
export type AdaptadorVista = { id: string; nombre: string; proveedor: string; descripcion_envio: string; activo: boolean; config: ConfigExterno };

export async function listarAdaptadores(): Promise<AdaptadorVista[]> { return apiGet("/v1/admin/externos"); }
export async function guardarAdaptador(id: string, cfg: ConfigExterno): Promise<void> { await apiPut(`/v1/admin/externos/${id}`, cfg); }

export type CalibracionVista = { herramienta: string; modelo: string; version: string; metricas: unknown } | null;
export async function obtenerCalibracion(herramienta: string): Promise<CalibracionVista> { return apiGet(`/v1/admin/calibraciones/${herramienta}`); }
```

Usa los helpers reales del archivo (`apiGet`/`apiPut`/`apiPost` o los que ya existan; revisa
`ColaboracionView`'s import de `api.ts` del spec de 2026-09-19 para copiar el patrón exacto de
llamada PUT/PATCH que ya usa el resto del admin).

- [ ] **Paso 2: `ServiciosExternosView.tsx`, calcado del patrón de `ColaboracionView`**

Abre `client/src/admin/ColaboracionView.tsx` (ya existe, del spec de 2026-09-19) y copia su
estructura de `Seccion` + campos + guardado con `useState`/`useEffect`. La vista nueva:

```tsx
import { useEffect, useState } from "react";
import { AdaptadorVista, ConfigExterno, listarAdaptadores, guardarAdaptador } from "../lib/api";
import { Seccion } from "./Seccion";

export function ServiciosExternosView() {
  const [items, setItems] = useState<AdaptadorVista[]>([]);

  useEffect(() => { listarAdaptadores().then(setItems); }, []);

  async function actualizar(id: string, cfg: ConfigExterno) {
    await guardarAdaptador(id, cfg);
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, config: cfg } : a)));
  }

  return (
    <Seccion titulo="Servicios externos">
      <p className="text-muted text-sm">
        Cada adaptador solo se llama si está habilitado aquí. Un servicio activo (marcado abajo)
        puede notificar al objetivo o dejar rastro en su infraestructura: requiere una
        confirmación aparte de habilitarlo.
      </p>
      {items.map((a) => (
        <div key={a.id} className="border-t border-border py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-fg text-sm">{a.nombre}</div>
              <div className="text-subtle text-xs">{a.descripcion_envio}</div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={a.config.habilitado}
                onChange={(e) => actualizar(a.id, { ...a.config, habilitado: e.target.checked })}
              />
              Habilitado
            </label>
          </div>
          {a.config.habilitado && (
            <input
              className="bg-panel border border-border rounded px-2 py-1 text-xs font-mono"
              placeholder="clave de API"
              value={a.config.clave ?? ""}
              onChange={(e) => actualizar(a.id, { ...a.config, clave: e.target.value })}
            />
          )}
          {a.activo && a.config.habilitado && (
            <label className="flex items-center gap-2 text-xs text-warning">
              <input
                type="checkbox"
                checked={a.config.confirmado_activo}
                onChange={(e) => actualizar(a.id, { ...a.config, confirmado_activo: e.target.checked })}
              />
              Confirmo que este servicio es activo y puede tener consecuencias fuera de Lumi
            </label>
          )}
        </div>
      ))}
    </Seccion>
  );
}
```

Ajusta el import de `Seccion` y las clases de Tailwind a las que realmente exponga
`client/src/admin/Seccion.tsx` (nombre de export, props) — revísalo primero.

- [ ] **Paso 3: `AuditorView.tsx`**

```tsx
import { useEffect, useState } from "react";
import { CalibracionVista, obtenerCalibracion } from "../lib/api";
import { Seccion } from "./Seccion";

const HERRAMIENTAS = ["geolocalizar"]; // se amplía spec a spec según se registren

export function AuditorView() {
  const [calibraciones, setCalibraciones] = useState<Record<string, CalibracionVista>>({});

  useEffect(() => {
    HERRAMIENTAS.forEach((h) => {
      obtenerCalibracion(h).then((c) => setCalibraciones((prev) => ({ ...prev, [h]: c })));
    });
  }, []);

  return (
    <Seccion titulo="Auditor IA">
      <p className="text-muted text-sm">
        El auditor no se activa para una herramienta sin una calibración vigente. Sin ella,
        cada veredicto es una abstención explícita.
      </p>
      {HERRAMIENTAS.map((h) => (
        <div key={h} className="border-t border-border py-3 flex items-center justify-between">
          <span className="text-fg text-sm">{h}</span>
          <span className="text-xs font-mono text-muted">
            {calibraciones[h] ? `calibrado · ${calibraciones[h]!.modelo} ${calibraciones[h]!.version}` : "sin calibrar"}
          </span>
        </div>
      ))}
    </Seccion>
  );
}
```

- [ ] **Paso 4: enlazar en la barra lateral y el panel**

Abre `client/src/admin/Sidebar.tsx` y `client/src/admin/AdminPanel.tsx`, localiza cómo
`ColaboracionView` (spec de 2026-09-19) se añadió a ambos, y replica exactamente el mismo
patrón para `ServiciosExternosView` (etiqueta "Servicios externos") y `AuditorView` (etiqueta
"Auditor IA"), en la misma sección donde vive Colaboración.

- [ ] **Paso 5: `npm run build` y `npm run lint` en `client/` — deben salir limpios**

- [ ] **Paso 6: commit**

```bash
git add client/src/admin/ServiciosExternosView.tsx client/src/admin/AuditorView.tsx client/src/admin/Sidebar.tsx client/src/admin/AdminPanel.tsx client/src/lib/api.ts
git commit -m "feat(darkroom-infra): panel de admin para servicios externos y calibración del auditor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Cierre — verificación de extremo a extremo

**Files:** ninguno nuevo; solo verificación.

- [ ] **Paso 1: `cargo build` en el workspace completo**

Run: `cargo build`
Expected: compila sin warnings nuevos.

- [ ] **Paso 2: toda la batería de tests de este plan**

Run: `cargo test -p lumi-proto && cargo test -p lumi-index && cargo test -p lumid`
Expected: todos en verde, incluidos los de las Tasks 1, 2, 3, 4, 5 y 6.

- [ ] **Paso 3: comprobación manual del gestor de VRAM con la herramienta `eco`**

Con el daemon en modo debug (`cargo run -p lumid` o `python tools/build.py`), crea una fuente
de tipo `imagen` con herramienta `eco` en un caso Darkroom (si el spec 2 ya expone «Añadir
fuente» con el registro extendido) o, si la UI de spec 2 aún no lista `eco`, invoca
`POST /v1/cases/:id/sources` directamente con `curl` pasando `herramienta: "eco"`. Comprueba
en el log que `queue::ejecutar_herramienta` lanza `workers/lumi_herramienta_eco.py`, que
aparece un resultado en `resultados` y una pista en `pistas_region`, sin usar VRAM real (la
reserva del gestor solo se ejercita si `eco` declara un papel con modelos — con el registro de
este plan, `eco` no tiene modelos instalados, así que `capacidad_de` debe devolver
`NoInstalado`, lo cual es el comportamiento correcto y honesto).

- [ ] **Paso 4: comprobación manual de `GET /v1/capacidades`**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:7717/v1/capacidades | jq
```

Expected: `geolocalizar` aparece `disponible` en los tres niveles que tengan sus modelos de
recuperación instalados; en modo debug, `eco` aparece `no_instalado` en todos los niveles
(porque no hay ningún modelo real con id `eco` en `registros/modelos/`).

- [ ] **Paso 5: comprobación manual del auditor sin calibrar**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:7717/v1/admin/calibraciones/geolocalizar | jq
```

Expected: `null` (sin calibración vigente), y cualquier llamada a `auditor::auditar` para esa
herramienta devuelve `Abstencion`.

- [ ] **Paso 6: `npx tsc -b --noEmit` y `npm run lint` en `client/`**

Expected: limpios.

- [ ] **Paso 7: commit final si quedó algo suelto**

```bash
git status
# si hay cambios sin commitear de la verificación (por ejemplo, un ajuste de tipos
# descubierto al probar de punta a punta), commitéalos con:
git add -A
git commit -m "chore(darkroom-infra): ajustes de cierre tras verificación de extremo a extremo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Cobertura del spec (`spectools.md`):**
- §1.1 registro de herramientas → Task 1.
- §1.2 matriz de capacidades → Task 1 (`EstadoCapacidad`, `capacidad_de`) y Task 7 (endpoint).
- §1.3 contrato de worker → Task 3.
- §2.1 manifiestos instalables / §2.2 gestor de VRAM → Task 2.
- §2.3 servicio VLM/LLM compartido y enrutado → Task 5.
- §3.1-3.2 adaptadores externos y auditoría → Task 4.
- §3.3 límite de alcance (sin GHunt, sin SpiderFoot, sin base legal) → respetado: ningún
  adaptador real se añade; solo el trait y un adaptador de desarrollo.
- §4.1-4.2 auditor con abstención y calibración → Task 5.
- §4.3 pistas de región → Task 6.
- §5 API y superficie → Tasks 4, 5, 6, 7 cubren las rutas listadas; el panel de admin de la
  tabla del spec se cubre en Task 8.
- §6 "lo que no hace" → ninguna tarea de este plan añade una herramienta usable, entrena
  modelos ni automatiza matrícula/scraping/credenciales.
- Verificación del spec (registro, LRU, contrato, adaptador deshabilitado, dos entradas de
  auditoría, calibración caduca, pista sin reponderación previa) → cubierta por los tests de
  las Tasks 1, 2, 3, 4, 5, 6 y el cierre manual de Task 9.

**Placeholders:** ninguno; cada paso de código trae la implementación completa. Las
referencias a "ajusta a la firma real de X del spec 2" son intencionadas y están acotadas
(un nombre de función, no una lógica por escribir), porque el spec 2 aún no está implementado
y sus firmas exactas solo se conocerán al ejecutar ese plan primero.

**Consistencia de tipos:** `EstadoCapacidad` (Task 1) se usa igual en `GestorModelos::reservar`
(Task 2) y en `GET /v1/capacidades` (Task 7). `TareaHerramienta`/`MsgHerramienta` (Task 3) son
los mismos tipos que consume `herramienta_worker::lanzar` y que produce
`herramientas_resultados::persistir` (completado en Tasks 3 y 6). `ConfigExterno` (Task 4) es
el mismo tipo en la ruta de admin (Task 4) y en el cliente (Task 8).

**Orden de dependencia:** Task 1 no depende de nada nuevo de este plan. Task 2 depende de
`EstadoCapacidad` de Task 1. Task 3 depende de `GestorModelos` de Task 2 solo por wiring
futuro (no lo usa todavía de forma estricta, se deja para cuando una herramienta real declare
un papel con modelos). Task 4 es independiente de 2 y 3. Task 5 depende de Task 4 solo para el
enrutado externo (usa `reqwest` directo, no pasa por `externos::enviar` porque el LLM
compartido tiene su propia auditoría de calibración, no la de servicios externos — nota: si se
prefiere que el enrutado a OpenRouter también pase por `externos::enviar` para reusar su
bitácora, es un cambio de una línea en Task 5 Paso 3, dejado a discreción de quien ejecute,
sin que rompa ninguna interfaz de otra tarea). Task 6 depende de Task 3 (persistir pistas) y
del esquema de `resultados`/`analysis_hypotheses` del spec 2. Task 7 depende de Task 1. Task 8
depende de Tasks 4 y 5.

## Execution Handoff

Plan completo y guardado en
`docs/superpowers/plans/2026-09-22-darkroom2-03-infraestructura-herramientas.md`.

Dado que ya se ha dejado constancia en este mismo proyecto de que la preferencia es **un solo
agente para todo el plan** (no orquestación tarea por tarea con subagentes y revisión
intermedia), la recomendación es:

**Inline Execution** — ejecutar las 9 tareas en esta sesión con `superpowers:executing-plans`,
en orden, con checkpoints de commit por tarea tal como está escrito arriba.

Si prefieres lo contrario esta vez (Subagent-Driven, con **superpowers:subagent-driven-development**
y un agente por tarea), dilo y cambio de modo.
