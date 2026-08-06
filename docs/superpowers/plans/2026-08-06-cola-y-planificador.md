# Cola y planificador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un análisis `pendiente` se convierta en un resultado, repartido entre
trabajadores persistentes que hablan con el daemon por tuberías.

**Architecture:** Una cola en `lumid` reparte trabajos con un planificador que es una función
pura, y unos trabajadores —un proceso hijo de Python por dispositivo, vivos entre trabajos—
los ejecutan. Se hablan por `stdin`/`stdout` con JSON por líneas; ese contrato es la frontera
Rust↔Python que heredará el subsistema 5. El cliente se entera por un SSE, y esa misma
conexión abierta es la señal de que su dueño está presente.

**Tech Stack:** Rust (axum 0.7, tokio, rusqlite 0.32 bundled, async-stream), Python 3 sin
dependencias, TypeScript/React 19 en el cliente, Tauri v2 como puente.

**Spec:** [`2026-08-06-cola-y-planificador-design.md`](../specs/2026-08-06-cola-y-planificador-design.md)

## Global Constraints

- **Identificadores, comentarios y mensajes en español.** Los mensajes de error los lee el
  investigador, no un desarrollador inglés.
- **Los comentarios explican el *porqué*, nunca el *qué*.** Un comentario que repite lo que
  dice la línea de abajo sobra.
- **`ponytail`: la solución más simple que funcione.** No se añade una abstracción sin un
  segundo caso real que la pida.
- **Un commit por tarea terminada**, no commits intermedios.
- **Sin tests salvo los que este plan indica.** Son cinco en total y están donde la lógica no
  es trivial; las tareas mecánicas no llevan ninguno.
- **Ningún secreto en una ruta.** Los tokens viajan en la cabecera `Authorization`, jamás en
  una URL o un path.
- **Al trabajador se le cree el log, no los datos.** Todo número que llega de un trabajador se
  valida antes de tocar la base de datos.
- **La imagen original nunca se reescribe.** Los trabajadores la abren en lectura.
- **`limits::effective` es la única puerta a los límites.** Nunca leer la tabla `limits`
  directamente.
- **El progreso no se persiste jamás.** Se retransmite por el SSE y se olvida. Es la condición
  bajo la que SQLite con un solo mutex sigue siendo viable.
- **Nada de estados nuevos en `analyses`.** Los cuatro actuales (`pendiente`, `en_curso`,
  `hecho`, `error`) son los únicos que hay.
- **Lo que ya corre nunca se cancela ni se mata.**
- **Verificación de compilación:** `cargo test -p lumid -p lumi-proto` y, en las tareas de
  cliente, `npm run build` desde `client/`.

---

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `crates/lumi-proto/src/worker.rs` | *Crear.* El contrato: tipos de los mensajes y validación de resultados | 1 |
| `crates/lumi-proto/src/lib.rs` | *Modificar.* Declarar el módulo | 1 |
| `workers/lumi_worker.py` | *Crear.* El trabajador de referencia | 2 |
| `crates/lumi-proto/src/api.rs` | *Modificar.* `Limits.background_jobs`, `QueueView`, `Cambio` | 3, 7 |
| `crates/lumid/src/limits.rs` | *Modificar.* La séptima clave | 3 |
| `crates/lumid/src/store.rs` | *Modificar.* Columna `requeues` y rearme de huérfanos | 3 |
| `crates/lumid/src/queue/plan.rs` | *Crear.* El planificador. Función pura | 4 |
| `crates/lumid/src/queue/worker.rs` | *Crear.* La vida de un proceso trabajador | 5 |
| `crates/lumid/src/queue/mod.rs` | *Crear.* La cola: estado, bucle, presencia, difusión | 6 |
| `crates/lumid/src/main.rs` | *Modificar.* `App.queue`, arranque, rutas nuevas | 6, 7 |
| `crates/lumid/src/routes/queue.rs` | *Crear.* SSE de eventos y foto para el administrador | 7 |
| `crates/lumid/src/telemetry.rs` | *Modificar.* `queue_depth` y `queue_paused` de verdad | 7 |
| `crates/lumid/src/routes/analyses.rs` | *Modificar.* 409 al borrar lo que corre; avisar a la cola al crear | 8 |
| `crates/lumid/src/routes/images.rs` | *Modificar.* 409 al borrar una imagen en uso | 8 |
| `client/src-tauri/src/main.rs` | *Modificar.* Puente SSE de la cola | 9 |
| `client/src/lib/api.ts` | *Modificar.* `Limits.background_jobs`, tipo `Cambio` | 9 |
| `client/src/work/CaseView.tsx` | *Modificar.* Enganche al SSE, quitar `/fake` | 9 |
| `ARCHITECTURE.md`, `README.md`, `FUTURO.md` | *Modificar.* Estado, rutas nuevas, aparcados | 10 |

---

### Task 1: El contrato con los trabajadores

Los tipos viven en `lumi-proto` y no en `lumid` porque **son el contrato**: quien escriba otro
trabajador los lee para saber qué tiene que cumplir.

**Files:**
- Create: `crates/lumi-proto/src/worker.rs`
- Modify: `crates/lumi-proto/src/lib.rs`

**Interfaces:**
- Consumes: nada.
- Produces: `lumi_proto::worker::{Job, Msg}`. `Job::nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Job`. `Msg::validar(&self) -> Result<(), &'static str>`. `Msg` es un enum con variantes `Listo { dispositivo: String, modelo: Option<String> }`, `Progreso { id: i64, fase: String, pct: u8 }`, `Resultado { id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64 }` y `Fallo { id: i64, motivo: String }`.

- [ ] **Step 1: Escribir el módulo con su prueba**

Crear `crates/lumi-proto/src/worker.rs`:

```rust
//! El contrato con los trabajadores de inferencia: JSON por líneas sobre las
//! tuberías estándar del proceso hijo.
//!
//! Vive en `lumi-proto` y no en `lumid` porque es el contrato, no un detalle
//! del daemon: quien escriba un trabajador nuevo lee esto para saber qué tiene
//! que cumplir. El subsistema 5 sustituye las tripas del trabajador de
//! referencia sin tocar ni una línea de aquí.

use serde::{Deserialize, Serialize};

/// Lo que el daemon manda por `stdin`, una línea por trabajo.
///
/// Las imágenes viajan como RUTAS y no como bytes: empujar decenas de MB por
/// una tubería en cada trabajo sería trabajo tirado, y el trabajador corre como
/// el mismo usuario en la misma máquina. El día que las imágenes se cifren en
/// reposo, esta es la decisión que hay que revisar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Job {
    /// Siempre `"trabajo"`. Va explícito para que añadir órdenes nuevas en el
    /// futuro no rompa a un trabajador que solo entiende esta.
    pub tipo: String,
    pub id: i64,
    pub modelo: String,
    pub imagenes: Vec<String>,
}

impl Job {
    pub fn nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Self {
        Self { tipo: "trabajo".into(), id, modelo, imagenes }
    }
}

/// Lo que el trabajador contesta por `stdout`. Su `stderr` es el log y no
/// tiene contrato: se guarda tal cual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum Msg {
    /// Obligatorio al arrancar, con `modelo: None`, y otra vez cada vez que
    /// cambia de modelo. Hasta que llega, el trabajador NO cuenta como
    /// disponible: sin esta línea, «el modelo está cargando» y «la cola está
    /// colgada» se ven exactamente igual.
    Listo { dispositivo: String, modelo: Option<String> },
    /// Cuantos quiera. No se persiste nunca: se retransmite y se olvida.
    Progreso { id: i64, fase: String, pct: u8 },
    Resultado { id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64 },
    /// El motor contestó «no puedo». Es un RESULTADO, no una avería: no se
    /// reintenta, porque reintentarlo solo quema GPU.
    Fallo { id: i64, motivo: String },
}

impl Msg {
    /// Al trabajador se le cree el log, no los datos.
    ///
    /// Un `NaN` o una latitud de 300 llegarían hasta el mapa y lo romperían sin
    /// que nadie supiera por qué. Los rangos comparados con `NaN` dan siempre
    /// falso, así que `is_finite` solo hace falta donde no hay rango cerrado.
    pub fn validar(&self) -> Result<(), &'static str> {
        let Msg::Resultado { lat, lng, radio_m, confianza, .. } = self else {
            return Ok(());
        };
        if !(-90.0..=90.0).contains(lat) {
            return Err("la latitud no está entre -90 y 90");
        }
        if !(-180.0..=180.0).contains(lng) {
            return Err("la longitud no está entre -180 y 180");
        }
        if !radio_m.is_finite() || *radio_m <= 0.0 {
            return Err("el radio no es un número positivo");
        }
        if !(0.0..=1.0).contains(confianza) {
            return Err("la confianza no está entre 0 y 1");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_contrato_aguanta_basura_y_rechaza_numeros_imposibles() {
        // Una línea que no es JSON no entra por ningún lado. En el daemon esto
        // se registra y se sigue: un `print` de depuración perdido en el motor
        // no puede tumbar la cola.
        assert!(serde_json::from_str::<Msg>("esto no es json").is_err());
        assert!(serde_json::from_str::<Msg>(r#"{"tipo":"inventado","id":1}"#).is_err());

        // `listo` sin modelo es lo normal recién arrancado.
        let l: Msg =
            serde_json::from_str(r#"{"tipo":"listo","dispositivo":"cpu","modelo":null}"#).unwrap();
        assert_eq!(l, Msg::Listo { dispositivo: "cpu".into(), modelo: None });

        let bueno: Msg = serde_json::from_str(
            r#"{"tipo":"resultado","id":42,"lat":43.36,"lng":-8.41,"radio_m":1400,"confianza":0.72}"#,
        )
        .unwrap();
        assert!(bueno.validar().is_ok());

        for malo in [
            r#"{"tipo":"resultado","id":1,"lat":91,"lng":0,"radio_m":10,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":181,"radio_m":10,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":0,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":10,"confianza":1.5}"#,
        ] {
            let m: Msg = serde_json::from_str(malo).unwrap();
            assert!(m.validar().is_err(), "debería rechazarse: {malo}");
        }

        // Y un fallo del motor pasa la validación: es un resultado legítimo.
        let f = Msg::Fallo { id: 1, motivo: "sin puntos de referencia".into() };
        assert!(f.validar().is_ok());

        // El trabajo se serializa con su `tipo` puesto.
        let j = Job::nuevo(7, "mini".into(), vec!["/tmp/a".into()]);
        let s = serde_json::to_string(&j).unwrap();
        assert!(s.contains(r#""tipo":"trabajo""#), "{s}");
        assert_eq!(serde_json::from_str::<Job>(&s).unwrap(), j);
    }
}
```

- [ ] **Step 2: Declarar el módulo**

En `crates/lumi-proto/src/lib.rs`, añadir junto a los `pub mod` que ya hay:

```rust
pub mod worker;
```

- [ ] **Step 3: Ejecutar la prueba**

Run: `cargo test -p lumi-proto worker`
Expected: PASS, `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add crates/lumi-proto/src/worker.rs crates/lumi-proto/src/lib.rs
git commit -m "El contrato con los trabajadores, y validar lo que contestan"
```

---

### Task 2: El trabajador de referencia

Sin dependencias de Python a propósito: tiene que arrancar en cualquier intérprete, incluido
el del sistema en un WSL recién instalado, para que la prueba de punta a punta de la tarea 5
no dependa del venv de torch.

**Files:**
- Create: `workers/lumi_worker.py`

**Interfaces:**
- Consumes: el contrato de la tarea 1 (formato de línea, no código).
- Produces: un script ejecutable en `workers/lumi_worker.py`. Lee `LUMI_DEVICE` (por defecto `cpu`) y `LUMI_FAKE_LOAD_S` (por defecto `0`) del entorno.

- [ ] **Step 1: Escribir el trabajador**

Crear `workers/lumi_worker.py`:

```python
#!/usr/bin/env python3
"""Trabajador de referencia de Lumi.

No infiere nada: devuelve una coordenada fija. Existe para que el contrato del
subsistema 4 sea ejecutable y no solo un documento — la unica forma de saber si
una frontera aguanta es cruzarla.

El subsistema 5 sustituye `_cargar` y `_resolver` por la carga de pesos y la
inferencia de verdad. No deberia tener que tocar nada mas de este archivo, y
nada en absoluto del daemon.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout, el
log va por stderr. Sin dependencias: tiene que arrancar en el interprete del
sistema, sin venv.
"""
import json
import os
import sys
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
# Lo que tardaria en cargar pesos de verdad. Se puede subir a mano para probar
# que el daemon aguanta un arranque lento sin dar el trabajador por muerto.
CARGA_S = float(os.environ.get("LUMI_FAKE_LOAD_S", "0"))

_modelo = None


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(modelo):
    """El subsistema 5 sustituye esto por la carga real de pesos."""
    global _modelo
    if _modelo == modelo:
        return
    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    time.sleep(CARGA_S)
    _modelo = modelo
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": _modelo})


def _resolver(job):
    """El subsistema 5 sustituye esto por la inferencia real."""
    for ruta in job["imagenes"]:
        if not os.path.exists(ruta):
            return {"tipo": "fallo", "id": job["id"],
                    "motivo": "no existe la imagen %s" % ruta}
    _decir({"tipo": "progreso", "id": job["id"], "fase": "extrayendo", "pct": 50})
    # Fijas y no aleatorias: dos ejecuciones dan lo mismo y una captura de
    # pantalla sigue valiendo manana.
    return {"tipo": "resultado", "id": job["id"],
            "lat": 43.3612, "lng": -8.4104, "radio_m": 1400.0, "confianza": 0.72}


def main():
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": None})
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            job = json.loads(linea)
        except ValueError:
            _log("linea ilegible, se ignora: %s" % linea[:120])
            continue
        if job.get("tipo") != "trabajo":
            _log("orden desconocida, se ignora: %s" % job.get("tipo"))
            continue
        try:
            _cargar(job["modelo"])
        except Exception as e:
            # No poder cargar el modelo es un fallo DE ESTE TRABAJO, no una
            # averia del trabajador: se contesta y se sigue vivo esperando el
            # siguiente, que puede pedir un modelo que si esta.
            _decir({"tipo": "fallo", "id": job["id"],
                    "motivo": "no se pudo cargar el modelo %s: %s" % (job["modelo"], e)})
            continue
        try:
            _decir(_resolver(job))
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Comprobar que cumple el contrato**

Run:
```bash
printf '%s\n' '{"tipo":"trabajo","id":1,"modelo":"mini","imagenes":[]}' | python3 workers/lumi_worker.py
```

Expected: exactamente estas cuatro líneas, en este orden.
```
{"tipo": "listo", "dispositivo": "cpu", "modelo": null}
{"tipo": "listo", "dispositivo": "cpu", "modelo": "mini"}
{"tipo": "progreso", "id": 1, "fase": "extrayendo", "pct": 50}
{"tipo": "resultado", "id": 1, "lat": 43.3612, "lng": -8.4104, "radio_m": 1400.0, "confianza": 0.72}
```

- [ ] **Step 3: Comprobar que la basura no lo mata**

Run:
```bash
printf '%s\n' 'esto no es json' '{"tipo":"trabajo","id":2,"modelo":"mini","imagenes":["/no/existe"]}' | python3 workers/lumi_worker.py
```

Expected: en `stdout`, el `listo` inicial, un segundo `listo` con `"modelo": "mini"`, y
`{"tipo": "fallo", "id": 2, "motivo": "no existe la imagen /no/existe"}`. La línea ilegible
sale por `stderr` y el proceso termina con código 0.

- [ ] **Step 4: Commit**

```bash
git add workers/lumi_worker.py
git commit -m "Un trabajador de referencia que cumple el contrato sin inferir nada"
```

---

### Task 3: Los cambios de datos

Tres cambios pequeños que la cola necesita antes de existir. Van juntos porque son la misma
capa y ninguno tiene sentido suelto.

**Files:**
- Modify: `crates/lumi-proto/src/api.rs` (struct `Limits` y su `Default`)
- Modify: `crates/lumid/src/limits.rs` (`KEYS` y `apply`)
- Modify: `crates/lumid/src/store.rs` (`migrate` y método nuevo)

**Interfaces:**
- Consumes: nada.
- Produces: `Limits.background_jobs: bool` (por defecto `false`). La clave `"background_jobs"` en `limits::KEYS`. La columna `analyses.requeues INTEGER NOT NULL DEFAULT 0`. `Store::rearmar_trabajos_huerfanos(&self) -> usize`.

- [ ] **Step 1: Añadir el límite al tipo compartido**

En `crates/lumi-proto/src/api.rs`, dentro de `pub struct Limits`, después de `queue_priority`:

```rust
    /// Si su trabajo pendiente sigue avanzando cuando se desconecta. Con esto
    /// apagado, lo pendiente de quien se va se queda quieto hasta que vuelve;
    /// con ello encendido avanza, pero siempre por detrás de quien sí está
    /// delante de la pantalla. Lo que YA está corriendo termina en los dos
    /// casos: el cómputo gastado no se tira.
    pub background_jobs: bool,
```

Y en `impl Default for Limits`, después de `queue_priority: 0,`:

```rust
            // Apagado por defecto: que el administrador lo *pueda* habilitar,
            // no que esté habilitado sin que nadie lo decida.
            background_jobs: false,
```

- [ ] **Step 2: Añadir la clave a los límites**

En `crates/lumid/src/limits.rs`, cambiar la constante:

```rust
pub const KEYS: [&str; 7] = [
    "models",
    "max_concurrent",
    "max_daily",
    "max_storage_gb",
    "queue_priority",
    "can_create_projects",
    "background_jobs",
];
```

Y en `fn apply`, antes del `_ => {}`:

```rust
        "background_jobs" => l.background_jobs = v.as_bool().unwrap_or(l.background_jobs),
```

- [ ] **Step 3: Ampliar la prueba de límites que ya existe**

En `crates/lumid/src/limits.rs`, dentro de
`fn la_anulacion_gana_al_global_y_el_resto_se_hereda`, justo antes de `drop(s);`:

```rust
        // El límite nuevo hereda la misma maquinaria de dos niveles que los
        // otros seis, sin nada específico suyo.
        assert!(!effective(&s, 1).background_jobs, "apagado por defecto");
        set(&s, None, "background_jobs", &serde_json::json!(true)).unwrap();
        assert!(effective(&s, 1).background_jobs);
        set(&s, Some(1), "background_jobs", &serde_json::json!(false)).unwrap();
        assert!(!effective(&s, 1).background_jobs);
        assert!(effective(&s, 2).background_jobs);
```

- [ ] **Step 4: Añadir la columna y el rearme**

En `crates/lumid/src/store.rs`, dentro del array de `fn migrate`, después de
`("project_members", "invited_by", "INTEGER"),`:

```rust
        // Cuántas veces ha vuelto a la cola por muerte de su trabajador. Sin
        // tope, una imagen envenenada tumbaría a la misma GPU en bucle para
        // siempre.
        ("analyses", "requeues", "INTEGER NOT NULL DEFAULT 0"),
```

Y añadir el método al `impl Store`, después de `get_meta`:

```rust
    /// Todo `en_curso` que exista al arrancar es un resto de una caída: ningún
    /// trabajador sobrevive al daemon, así que no puede haber nada corriendo de
    /// verdad. Sin esto, un corte de luz deja trabajos que nadie recogerá jamás.
    ///
    /// Devuelve cuántos ha rearmado, para poder decirlo en el log de arranque.
    pub fn rearmar_trabajos_huerfanos(&self) -> usize {
        self.conn()
            .execute("UPDATE analyses SET state = 'pendiente' WHERE state = 'en_curso'", [])
            .unwrap_or(0)
    }
```

- [ ] **Step 5: Escribir la prueba del rearme**

En `crates/lumid/src/store.rs`, dentro de `mod tests`:

```rust
    #[test]
    fn los_trabajos_en_curso_se_rearman_al_abrir() {
        let dir = std::env::temp_dir().join(format!("lumi-huerf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        s.conn()
            .execute(
                "INSERT INTO analyses (id, case_id, requested_by, model, state, created_at)
                 VALUES (1, 1, 1, 'mini', 'en_curso', 0), (2, 1, 1, 'mini', 'pendiente', 0),
                        (3, 1, 1, 'mini', 'hecho', 0)",
                [],
            )
            .unwrap();

        assert_eq!(s.rearmar_trabajos_huerfanos(), 1, "solo el que estaba en curso");

        let estados: Vec<String> = {
            let c = s.conn();
            let mut q = c.prepare("SELECT state FROM analyses ORDER BY id").unwrap();
            let v = q.query_map([], |r| r.get(0)).unwrap().flatten().collect();
            v
        };
        assert_eq!(estados, vec!["pendiente", "pendiente", "hecho"], "lo hecho no se toca");

        // Y la columna del tope de reintentos existe y nace a cero.
        let r: i64 = s
            .conn()
            .query_row("SELECT requeues FROM analyses WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(r, 0);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
```

- [ ] **Step 6: Ejecutar las pruebas**

Run: `cargo test -p lumid limits:: store::`
Expected: PASS. `la_anulacion_gana_al_global_y_el_resto_se_hereda` y
`los_trabajos_en_curso_se_rearman_al_abrir` en verde.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/limits.rs crates/lumid/src/store.rs
git commit -m "El limite de segundo plano, el tope de reintentos y el rearme de huerfanos"
```

---

### Task 4: El planificador

Una función pura, y ese es el punto: toda la política vive aquí y se puede verificar sin
GPUs, sin procesos y sin base de datos.

**Files:**
- Create: `crates/lumid/src/queue/plan.rs`

**Interfaces:**
- Consumes: nada.
- Produces: `queue::plan::{Candidato, Dueno, Libre, Asignacion, repartir}`. La firma es `repartir(candidatos: &[Candidato], duenos: &HashMap<i64, Dueno>, libres: &[Libre]) -> Vec<Asignacion>`.

- [ ] **Step 1: Escribir el planificador con su prueba**

Crear `crates/lumid/src/queue/plan.rs`:

```rust
//! Quién corre ahora y en qué dispositivo.
//!
//! Es una función pura a propósito. Toda la política —prioridades, conectado
//! contra segundo plano, cupos, bloqueos— es donde más fácil es equivocarse y
//! donde más caro sale depurar contra hardware real. Aquí entra una lista y
//! sale otra: sin base de datos, sin procesos y sin reloj.

use std::collections::HashMap;

/// Un trabajo esperando.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidato {
    pub analysis_id: i64,
    pub user_id: i64,
    pub modelo: String,
    pub created_at: i64,
}

/// Lo que se sabe del dueño de un trabajo en el instante de repartir.
///
/// «Pausado» no es un estado del trabajo sino una propiedad de su dueño mirada
/// aquí. Por eso bloqueado, desconectado y con el cupo lleno son la misma cosa:
/// filtros. Como no se guardan en ninguna parte, no pueden atascarse.
#[derive(Debug, Clone, Copy)]
pub struct Dueno {
    pub bloqueado: bool,
    pub conectado: bool,
    pub segundo_plano: bool,
    pub max_concurrent: i64,
    pub prioridad: i64,
    /// Cuántos tiene ya corriendo, antes de este reparto.
    pub en_curso: i64,
}

/// Un trabajador que ha dicho `listo` y no tiene trabajo en la mano.
#[derive(Debug, Clone, PartialEq)]
pub struct Libre {
    pub dispositivo: String,
    /// El modelo que ya tiene cargado. `None` recién arrancado.
    pub modelo: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Asignacion {
    pub analysis_id: i64,
    pub dispositivo: String,
}

pub fn repartir(
    candidatos: &[Candidato],
    duenos: &HashMap<i64, Dueno>,
    libres: &[Libre],
) -> Vec<Asignacion> {
    // 1. Descarta lo que no puede correr ahora mismo. Un candidato sin dueño
    //    conocido se cae solo con el `?`: es un usuario borrado y su trabajo no
    //    tiene a quién pertenecer.
    let mut cola: Vec<(&Candidato, &Dueno)> = candidatos
        .iter()
        .filter_map(|c| Some((c, duenos.get(&c.user_id)?)))
        .filter(|(_, d)| !d.bloqueado)
        .filter(|(_, d)| d.conectado || d.segundo_plano)
        .filter(|(_, d)| d.en_curso < d.max_concurrent)
        .collect();

    // 2. Ordena: conectado antes que segundo plano, luego prioridad de mayor a
    //    menor, y a igualdad el que lleva más esperando. `sort_by` es estable,
    //    así que un empate total respeta el orden en que vinieron.
    cola.sort_by(|(ca, da), (cb, db)| {
        db.conectado
            .cmp(&da.conectado)
            .then(db.prioridad.cmp(&da.prioridad))
            .then(ca.created_at.cmp(&cb.created_at))
    });

    // 3. Asigna. `comprometidos` cuenta lo que ESTE reparto ya dio: sin eso, un
    //    usuario con cupo 2 y cinco trabajos se llevaría los cinco de una
    //    tacada, porque `en_curso` es la foto de antes de empezar a repartir.
    let mut comprometidos: HashMap<i64, i64> = HashMap::new();
    let mut disponibles: Vec<Libre> = libres.to_vec();
    let mut out = Vec::new();

    for (c, d) in cola {
        if disponibles.is_empty() {
            break;
        }
        let ya = comprometidos.get(&c.user_id).copied().unwrap_or(0);
        if d.en_curso + ya >= d.max_concurrent {
            continue;
        }

        // Cambiar de modelo cuesta cargar pesos, así que entre dos libres gana
        // el que ya lo tiene puesto. Con varias GPUs esto hace que los
        // dispositivos se especialicen solos en el modelo que más les toca, sin
        // que nadie lo configure: no es un mecanismo aparte, es lo que emerge.
        let i = disponibles
            .iter()
            .position(|l| l.modelo.as_deref() == Some(c.modelo.as_str()))
            .unwrap_or(0);
        let elegido = disponibles.remove(i);
        out.push(Asignacion { analysis_id: c.analysis_id, dispositivo: elegido.dispositivo });
        *comprometidos.entry(c.user_id).or_insert(0) += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dueno(
        bloqueado: bool, conectado: bool, segundo_plano: bool,
        max_concurrent: i64, prioridad: i64, en_curso: i64,
    ) -> Dueno {
        Dueno { bloqueado, conectado, segundo_plano, max_concurrent, prioridad, en_curso }
    }
    fn cand(analysis_id: i64, user_id: i64, created_at: i64) -> Candidato {
        Candidato { analysis_id, user_id, modelo: "mini".into(), created_at }
    }
    fn libre(dispositivo: &str, modelo: Option<&str>) -> Libre {
        Libre { dispositivo: dispositivo.into(), modelo: modelo.map(String::from) }
    }

    #[test]
    fn la_politica_de_reparto() {
        let uno = [libre("cuda:0", None)];

        // Un bloqueado no corre aunque esté conectado y sea el único.
        let d = HashMap::from([(1, dueno(true, true, false, 2, 0, 0))]);
        assert!(repartir(&[cand(10, 1, 100)], &d, &uno).is_empty());

        // Un desconectado sin segundo plano tampoco.
        let d = HashMap::from([(1, dueno(false, false, false, 2, 0, 0))]);
        assert!(repartir(&[cand(10, 1, 100)], &d, &uno).is_empty());

        // Con segundo plano sí corre, pero detrás del conectado aunque pidiera
        // mucho antes: esa es toda la diferencia entre las dos categorías.
        let d = HashMap::from([
            (1, dueno(false, false, true, 2, 0, 0)),
            (2, dueno(false, true, false, 2, 0, 0)),
        ]);
        let r = repartir(&[cand(10, 1, 100), cand(20, 2, 900)], &d, &uno);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].analysis_id, 20, "el conectado va primero");

        // A igualdad de conexión manda la prioridad, y luego la llegada.
        let d = HashMap::from([
            (1, dueno(false, true, false, 5, 0, 0)),
            (2, dueno(false, true, false, 5, 3, 0)),
        ]);
        let tres = [libre("a", None), libre("b", None), libre("c", None)];
        let r = repartir(&[cand(10, 1, 100), cand(20, 2, 200), cand(30, 1, 50)], &d, &tres);
        assert_eq!(r.iter().map(|a| a.analysis_id).collect::<Vec<_>>(), vec![20, 30, 10]);

        // El cupo corta DENTRO del mismo reparto, no solo contra la foto previa.
        let cinco: Vec<Candidato> = (0..5).map(|i| cand(i, 1, i)).collect();
        let cuatro =
            [libre("a", None), libre("b", None), libre("c", None), libre("d", None)];
        let d = HashMap::from([(1, dueno(false, true, false, 2, 0, 0))]);
        assert_eq!(repartir(&cinco, &d, &cuatro).len(), 2);

        // Y con uno ya corriendo, solo cabe uno más.
        let d = HashMap::from([(1, dueno(false, true, false, 2, 0, 1))]);
        assert_eq!(repartir(&cinco, &d, &cuatro).len(), 1);

        // Entre dos libres gana el que ya tiene ese modelo cargado.
        let d = HashMap::from([(1, dueno(false, true, false, 5, 0, 0))]);
        let r = repartir(
            &[cand(10, 1, 100)],
            &d,
            &[libre("frio", Some("vision")), libre("caliente", Some("mini"))],
        );
        assert_eq!(r[0].dispositivo, "caliente");

        // Sin trabajadores no se reparte nada, y no revienta.
        assert!(repartir(&cinco, &d, &[]).is_empty());
    }
}
```

- [ ] **Step 2: Declarar el módulo provisionalmente**

En `crates/lumid/src/main.rs`, junto a los otros `mod`:

```rust
mod queue;
```

Y crear `crates/lumid/src/queue/mod.rs` con solo esto de momento (la tarea 6 lo completa):

```rust
pub mod plan;
```

- [ ] **Step 3: Ejecutar la prueba**

Run: `cargo test -p lumid plan::`
Expected: PASS, `la_politica_de_reparto`.

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/queue/ crates/lumid/src/main.rs
git commit -m "El planificador: una funcion pura con toda la politica dentro"
```

---

### Task 5: El trabajador como proceso

Aquí vive lo que el spec llamó «el precio de la decisión 2»: arrancar, vigilar y enterrar
procesos. La prueba de esta tarea es la de punta a punta, porque es la única que demuestra
que la frontera existe de verdad.

**Files:**
- Create: `crates/lumid/src/queue/worker.rs`
- Modify: `crates/lumid/src/queue/mod.rs` (declarar el módulo)

**Interfaces:**
- Consumes: `lumi_proto::worker::{Job, Msg}` de la tarea 1. El script de la tarea 2.
- Produces: `queue::worker::{Evento, Lanzado, spawn}`. `spawn(dispositivo: String, python: &Path, script: &Path, log: PathBuf, eventos: UnboundedSender<Evento>) -> anyhow::Result<Lanzado>`. `Lanzado` tiene `trabajos: UnboundedSender<Job>` y `matar: oneshot::Sender<()>`. `Evento` es un enum con `Listo { dispositivo: String, modelo: Option<String> }`, `Progreso { dispositivo: String, id: i64, fase: String, pct: u8 }`, `Resultado { dispositivo: String, id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64 }`, `Fallo { dispositivo: String, id: i64, motivo: String }` y `Muerto { dispositivo: String }`.

- [ ] **Step 1: Escribir el módulo**

Crear `crates/lumid/src/queue/worker.rs`:

```rust
//! La vida de un trabajador: un proceso hijo con el que se habla por tuberías.
//!
//! Sin puertos y sin autenticación: un trabajador solo puede recibir de su
//! padre, y muere con él, así que un reinicio del daemon no deja procesos
//! huérfanos ocupando VRAM. Es el mismo primitivo que el runner de tareas del
//! subsistema 1, que ya se escribió pensando en este momento.

use anyhow::Result;
use lumi_proto::worker::{Job, Msg};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::oneshot;

/// Lo que le pasa a un trabajador, ya etiquetado con quién es. La cola no
/// necesita saber nada más de él.
#[derive(Debug, Clone)]
pub enum Evento {
    Listo { dispositivo: String, modelo: Option<String> },
    Progreso { dispositivo: String, id: i64, fase: String, pct: u8 },
    Resultado { dispositivo: String, id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64 },
    Fallo { dispositivo: String, id: i64, motivo: String },
    /// Su `stdout` se cerró: el proceso terminó, con o sin gracia.
    Muerto { dispositivo: String },
}

impl Evento {
    /// El `dispositivo` se pone AQUÍ y no se lee del mensaje: el trabajador
    /// declara el suyo en `listo`, pero quién es lo decidimos nosotros al
    /// lanzarlo. Al trabajador se le cree el log, no los datos.
    fn de(dispositivo: &str, m: Msg) -> Self {
        let d = dispositivo.to_string();
        match m {
            Msg::Listo { modelo, .. } => Evento::Listo { dispositivo: d, modelo },
            Msg::Progreso { id, fase, pct } => Evento::Progreso { dispositivo: d, id, fase, pct },
            Msg::Resultado { id, lat, lng, radio_m, confianza } => {
                Evento::Resultado { dispositivo: d, id, lat, lng, radio_m, confianza }
            }
            Msg::Fallo { id, motivo } => Evento::Fallo { dispositivo: d, id, motivo },
        }
    }
}

/// Los dos hilos con los que la cola maneja un trabajador ya lanzado.
pub struct Lanzado {
    pub trabajos: UnboundedSender<Job>,
    /// Mandar aquí lo mata de verdad.
    ///
    /// Hace falta un matar explícito y no basta con cerrarle la entrada: el
    /// caso que hay que resolver es justo el del trabajador colgado cargando
    /// pesos, y ese no está leyendo su `stdin`, así que no se enteraría.
    pub matar: oneshot::Sender<()>,
}

/// Lanza un trabajador y devuelve por dónde hablarle.
///
/// No espera a que esté listo: el `Evento::Listo` llegará por el canal cuando
/// termine de cargar, que puede ser dentro de un minuto. Quien llama no debe
/// darle trabajo hasta entonces.
pub fn spawn(
    dispositivo: String,
    python: &Path,
    script: &Path,
    log: PathBuf,
    eventos: UnboundedSender<Evento>,
) -> Result<Lanzado> {
    let mut hijo = Command::new(python)
        // `-u` no es opcional: sin él Python almacena su salida y el daemon no
        // ve una línea hasta que el proceso muere. El `listo` no llegaría nunca
        // y el trabajador parecería colgado desde el primer segundo.
        .arg("-u")
        .arg(script)
        .env("LUMI_DEVICE", &dispositivo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Que el trabajador muera con el daemon es media razón de haber elegido
        // tuberías: si no, un reinicio deja la VRAM ocupada por un fantasma.
        .kill_on_drop(true)
        .spawn()?;

    let mut entrada = hijo.stdin.take().expect("stdin se pidió como piped");
    let salida = BufReader::new(hijo.stdout.take().expect("stdout se pidió como piped"));
    let errores = BufReader::new(hijo.stderr.take().expect("stderr se pidió como piped"));
    let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
    let (tx_matar, mut rx_matar) = oneshot::channel::<()>();

    // Las órdenes que le mandamos.
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            let Ok(linea) = serde_json::to_string(&job) else { continue };
            if entrada.write_all(format!("{linea}\n").as_bytes()).await.is_err() {
                break;
            }
            let _ = entrada.flush().await;
        }
    });

    // Su log, tal cual y sin interpretar. Es lo único suyo que no se valida.
    tokio::spawn(async move {
        if let Some(p) = log.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let mut l = errores.lines();
        while let Ok(Some(linea)) = l.next_line().await {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
                use std::io::Write;
                let _ = f.write_all(format!("{linea}\n").as_bytes());
            }
        }
    });

    // Sus respuestas.
    let dev = dispositivo.clone();
    tokio::spawn(async move {
        let mut l = salida.lines();
        loop {
            let linea = tokio::select! {
                r = l.next_line() => match r {
                    Ok(Some(t)) => t,
                    // `stdout` cerrado o ilegible: el proceso terminó.
                    _ => break,
                },
                _ = &mut rx_matar => {
                    tracing::warn!("[{dev}] se le acabó el plazo y se le mata");
                    let _ = hijo.kill().await;
                    break;
                }
            };
            match serde_json::from_str::<Msg>(&linea) {
                Ok(m) => {
                    if let Err(motivo) = m.validar() {
                        // Un número imposible no se guarda, pero tampoco se
                        // traga en silencio: el trabajo tiene que acabar en
                        // algo, o se quedaría en curso para siempre.
                        if let Msg::Resultado { id, .. } = m {
                            let _ = eventos.send(Evento::Fallo {
                                dispositivo: dev.clone(),
                                id,
                                motivo: format!(
                                    "el motor devolvió una coordenada imposible: {motivo}"
                                ),
                            });
                        }
                        continue;
                    }
                    if eventos.send(Evento::de(&dev, m)).is_err() {
                        break;
                    }
                }
                // Una línea ilegible no mata al trabajador: se registra y se
                // sigue. Un `print` de depuración perdido en el motor no puede
                // tumbar la cola entera.
                Err(e) => {
                    let corta: String = linea.chars().take(120).collect();
                    tracing::warn!("[{dev}] línea ilegible ({e}): {corta}");
                }
            }
        }
        let _ = hijo.wait().await;
        // Siempre, pase lo que pase: es lo que le dice a la cola que ese
        // dispositivo está libre para relanzarse y que su trabajo se ha
        // quedado sin dueño.
        let _ = eventos.send(Evento::Muerto { dispositivo: dev });
    });

    Ok(Lanzado { trabajos: tx, matar: tx_matar })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El entorno de pruebas puede no tener Python (por ejemplo un runner de CI
    /// mínimo). Sin él esta prueba se salta con un aviso en vez de fallar: lo
    /// que verifica es la frontera, no la presencia del intérprete.
    fn python3() -> Option<PathBuf> {
        ["python3", "python"].into_iter().find_map(|c| {
            std::process::Command::new(c)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|_| PathBuf::from(c))
        })
    }

    #[tokio::test]
    async fn el_trabajador_de_referencia_cumple_el_contrato() {
        let Some(python) = python3() else {
            eprintln!("sin python3 en el entorno: se salta la prueba de punta a punta");
            return;
        };
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_worker.py");
        let log = std::env::temp_dir().join(format!("lumi-w-{}.log", std::process::id()));
        let (tx_ev, mut rx_ev) = mpsc::unbounded_channel();
        let w = spawn("cpu".into(), &python, &script, log.clone(), tx_ev).unwrap();

        // Arranca diciendo que está, todavía sin ningún modelo cargado.
        match rx_ev.recv().await {
            Some(Evento::Listo { modelo: None, dispositivo }) => assert_eq!(dispositivo, "cpu"),
            otro => panic!("se esperaba `listo` sin modelo, llegó {otro:?}"),
        }

        w.trabajos.send(Job::nuevo(42, "mini".into(), vec![])).unwrap();

        // Carga el modelo y lo vuelve a decir.
        match rx_ev.recv().await {
            Some(Evento::Listo { modelo: Some(m), .. }) => assert_eq!(m, "mini"),
            otro => panic!("se esperaba `listo` con modelo, llegó {otro:?}"),
        }
        match rx_ev.recv().await {
            Some(Evento::Progreso { id, .. }) => assert_eq!(id, 42),
            otro => panic!("se esperaba progreso, llegó {otro:?}"),
        }
        // Y contesta un resultado válido para ESE id.
        match rx_ev.recv().await {
            Some(Evento::Resultado { id, lat, lng, .. }) => {
                assert_eq!(id, 42);
                assert!((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng));
            }
            otro => panic!("se esperaba resultado, llegó {otro:?}"),
        }

        // Y matarlo a mano llega hasta el final: es el camino que usa el
        // vigilante con un trabajador colgado cargando pesos.
        w.matar.send(()).unwrap();
        match rx_ev.recv().await {
            Some(Evento::Muerto { dispositivo }) => assert_eq!(dispositivo, "cpu"),
            otro => panic!("se esperaba `muerto`, llegó {otro:?}"),
        }
        std::fs::remove_file(log).ok();
    }
}
```

- [ ] **Step 2: Declarar el módulo**

En `crates/lumid/src/queue/mod.rs`:

```rust
pub mod plan;
pub mod worker;
```

- [ ] **Step 3: Ejecutar la prueba**

Run: `cargo test -p lumid worker::`
Expected: PASS. Si el entorno no tiene Python, sale
`sin python3 en el entorno: se salta la prueba de punta a punta` y pasa igual.

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/queue/
git commit -m "Los trabajadores son procesos hijo y la frontera se cruza de verdad"
```

---

### Task 6: La cola

Une el planificador con los trabajadores y con la base de datos, y los vigila. Es la pieza
con más código del plan; a cambio, ni la política ni el protocolo viven aquí.

El vigilante va en esta tarea y no aparte porque no se puede aprobar una cola que no relanza a
un trabajador muerto: sin él, un solo cuelgue deja esa GPU perdida hasta reiniciar el daemon.

**Files:**
- Modify: `crates/lumid/src/queue/mod.rs` (todo el contenido)
- Modify: `crates/lumi-proto/src/api.rs` (tipos `Cambio`, `QueueView`, `WorkerView`)
- Modify: `crates/lumid/src/main.rs` (`App.queue` y arranque)

**Interfaces:**
- Consumes: `plan::{Candidato, Dueno, Libre, repartir}`, `worker::{Evento, spawn}`, `Store::rearmar_trabajos_huerfanos`, `limits::effective`.
- Produces: `queue::Queue` con `Queue::arrancar(store: Arc<Store>, dir: PathBuf, gpus: &[GpuInfo]) -> Arc<Queue>`, `Queue::avisar(&self)`, `Queue::suscribir(&self) -> broadcast::Receiver<Cambio>`, `Queue::entra(&self, uid: i64) -> Presencia`, `Queue::foto(&self) -> QueueView`, `Queue::profundidad(&self) -> u32`, `Queue::hay_trabajadores(&self) -> bool`. En `App`, el campo `pub queue: Arc<queue::Queue>`.

- [ ] **Step 1: Añadir los tipos compartidos**

En `crates/lumi-proto/src/api.rs`, al final del archivo:

```rust
/// Lo que se retransmite por el SSE de la cola. El progreso va por aquí y NO se
/// escribe en ninguna parte: persistirlo es lo único que rompería el mutex
/// único de SQLite, así que se emite y se olvida.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum Cambio {
    Estado {
        /// A quién pertenece. Se filtra en el servidor y no se envía: el
        /// cliente no necesita su propio id para nada.
        #[serde(skip)]
        user_id: i64,
        analysis_id: i64,
        case_id: i64,
        estado: String,
    },
    Progreso {
        #[serde(skip)]
        user_id: i64,
        analysis_id: i64,
        fase: String,
        pct: u8,
    },
}

impl Cambio {
    pub fn user_id(&self) -> i64 {
        match self {
            Cambio::Estado { user_id, .. } | Cambio::Progreso { user_id, .. } => *user_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerView {
    pub dispositivo: String,
    /// El modelo cargado ahora mismo. `null` mientras arranca o entre cambios.
    pub modelo: Option<String>,
    /// El análisis que tiene en la mano, si tiene alguno.
    pub trabajo: Option<i64>,
    /// Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado.
    pub listo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
}
```

- [ ] **Step 2: Escribir la cola**

Sustituir por completo `crates/lumid/src/queue/mod.rs`:

```rust
//! La cola: quién espera, quién corre y quién puede ejecutarlo.
//!
//! Aquí no vive ni la política (está en `plan`, que es una función pura) ni el
//! protocolo (está en `lumi_proto::worker`). Esto es el pegamento: lee el
//! estado, se lo da al planificador, manda lo que diga y apunta lo que vuelve.

pub mod plan;
pub mod worker;

use crate::limits;
use crate::store::Store;
use lumi_proto::api::{Cambio, GpuInfo, QueueView, WorkerView};
use lumi_proto::worker::Job;
use plan::{Candidato, Dueno, Libre};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{broadcast, mpsc, oneshot};
use worker::Evento;

/// Cada cuánto se reparte aunque no haya pasado nada. Es una red de seguridad,
/// no el mecanismo: lo normal es que un aviso lo dispare al instante.
const TICK_S: u64 = 2;

/// Cuántas veces vuelve un trabajo a la cola tras morírsele el trabajador.
const MAX_REQUEUES: i64 = 1;

/// Plazo por defecto para que un trabajador diga `listo`. Va en `meta`
/// (`queue_listo_s`) y no compilado: un modelo grande en un disco lento puede
/// tardar más, y eso no debería obligar a recompilar el daemon.
const LISTO_S: u64 = 120;

/// Espera antes de relanzar un trabajador muerto, y su tope. Sin espera, un
/// dispositivo que no puede arrancar —CUDA rota, script borrado— se relanzaría
/// en bucle cerrado y llenaría el disco de log.
const RELANZAR_MIN_S: u64 = 2;
const RELANZAR_MAX_S: u64 = 60;

fn ahora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Un trabajador vivo, desde el punto de vista de la cola.
struct Vivo {
    modelo: Option<String>,
    trabajo: Option<i64>,
    listo: bool,
    /// Cuándo se lanzó. Solo se mira mientras `listo` es falso, para saber si
    /// se le ha pasado el plazo de arranque.
    desde: Instant,
    tx: mpsc::UnboundedSender<Job>,
    matar: Option<oneshot::Sender<()>>,
}

struct Estado {
    trabajadores: HashMap<String, Vivo>,
    /// Cuándo se puede volver a intentar cada dispositivo ausente, y cuántas
    /// veces seguidas ha fallado. Vive fuera de `trabajadores` porque tiene que
    /// sobrevivir precisamente a que el trabajador no exista.
    reintento: HashMap<String, (Instant, u32)>,
    /// Cuántos flujos SSE tiene abiertos cada usuario. Es la presencia, y vive
    /// en memoria a propósito: tras un reinicio nadie está conectado hasta que
    /// vuelve a llamar, que es exactamente lo correcto.
    presentes: HashMap<i64, usize>,
}

pub struct Queue {
    store: Arc<Store>,
    estado: Mutex<Estado>,
    avisos: mpsc::UnboundedSender<()>,
    difusion: broadcast::Sender<Cambio>,
    /// Con qué relanzar. Se calcula una vez al arrancar porque no cambia
    /// mientras el daemon vive, y el vigilante lo necesita a cada rato.
    dispositivos: Vec<String>,
    python: PathBuf,
    script: PathBuf,
    dir: PathBuf,
    eventos: mpsc::UnboundedSender<Evento>,
}

/// Mientras esto viva, su dueño cuenta como conectado. Se suelta cuando el
/// flujo SSE se cierra, sea porque cerró la app o porque se cayó la red — no
/// hay ventana de tiempo que ajustar ni escritura por petición que hacer.
pub struct Presencia {
    uid: i64,
    cola: Arc<Queue>,
}

impl Drop for Presencia {
    fn drop(&mut self) {
        if let Ok(mut e) = self.cola.estado.lock() {
            if let Some(n) = e.presentes.get_mut(&self.uid) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    e.presentes.remove(&self.uid);
                }
            }
        }
        // Que alguien se vaya puede liberar sitio para el trabajo de otro.
        self.cola.avisar();
    }
}

impl Queue {
    pub fn arrancar(store: Arc<Store>, dir: PathBuf, gpus: &[GpuInfo]) -> Arc<Self> {
        let rearmados = store.rearmar_trabajos_huerfanos();
        if rearmados > 0 {
            tracing::info!("{rearmados} trabajos quedaron a medias en la caída anterior; vuelven a la cola");
        }

        let (tx_avisos, rx_avisos) = mpsc::unbounded_channel();
        let (difusion, _) = broadcast::channel(256);
        let (tx_ev, rx_ev) = mpsc::unbounded_channel();

        let python = store
            .get_meta("models_dir")
            .map(|m| PathBuf::from(m).join("venv/bin/python3"))
            .filter(|p| p.exists())
            // Sin runtime instalado cae al intérprete del sistema: el trabajador
            // de referencia no necesita nada más, y así el entorno de desarrollo
            // funciona sin haber pasado por el asistente.
            .unwrap_or_else(|| PathBuf::from("python3"));
        let candidato = dir.join("workers/lumi_worker.py");
        let script =
            if candidato.exists() { candidato } else { PathBuf::from("workers/lumi_worker.py") };

        let mut dispositivos: Vec<String> =
            gpus.iter().map(|g| format!("cuda:{}", g.index)).collect();
        // Con GPU disponible, un trabajo que cae en CPU tarda tanto que parece
        // roto. Sin ninguna, el de CPU es lo único que hay — y por eso el
        // entorno de pruebas en WSL funciona sin hardware.
        let cpu_por_defecto = if dispositivos.is_empty() { "1" } else { "0" };
        if store.get_meta("queue_cpu_worker").as_deref().unwrap_or(cpu_por_defecto) == "1" {
            dispositivos.push("cpu".into());
        }

        let cola = Arc::new(Self {
            store,
            estado: Mutex::new(Estado {
                trabajadores: HashMap::new(),
                reintento: HashMap::new(),
                presentes: HashMap::new(),
            }),
            avisos: tx_avisos,
            difusion,
            dispositivos,
            python,
            script,
            dir,
            eventos: tx_ev,
        });

        // No se lanzan aquí: el vigilante del bucle ve que faltan todos y los
        // levanta en su primera pasada. Un solo camino para arrancar un
        // trabajador, y por tanto un solo sitio donde equivocarse.
        tokio::spawn(cola.clone().bucle(rx_avisos, rx_ev));
        cola
    }

    /// «Ha cambiado algo, mira a ver si puedes repartir». No bloquea nunca.
    pub fn avisar(&self) {
        let _ = self.avisos.send(());
    }

    pub fn suscribir(&self) -> broadcast::Receiver<Cambio> {
        self.difusion.subscribe()
    }

    pub fn entra(self: &Arc<Self>, uid: i64) -> Presencia {
        if let Ok(mut e) = self.estado.lock() {
            *e.presentes.entry(uid).or_insert(0) += 1;
        }
        // Llegar puede desbloquear trabajo propio que estaba pausado.
        self.avisar();
        Presencia { uid, cola: self.clone() }
    }

    pub fn profundidad(&self) -> u32 {
        self.store
            .conn()
            .query_row("SELECT COUNT(*) FROM analyses WHERE state = 'pendiente'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap_or(0) as u32
    }

    /// Sin ningún trabajador listo no se reparte nada: la cola está parada, y
    /// eso es lo que `queue_paused` debe significar.
    pub fn hay_trabajadores(&self) -> bool {
        self.estado
            .lock()
            .map(|e| e.trabajadores.values().any(|v| v.listo))
            .unwrap_or(false)
    }

    pub fn foto(&self) -> QueueView {
        let cuenta = |estado: &str| {
            self.store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE state = ?1",
                    [estado],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0) as u32
        };
        let trabajadores = self
            .estado
            .lock()
            .map(|e| {
                let mut v: Vec<WorkerView> = e
                    .trabajadores
                    .iter()
                    .map(|(d, w)| WorkerView {
                        dispositivo: d.clone(),
                        modelo: w.modelo.clone(),
                        trabajo: w.trabajo,
                        listo: w.listo,
                    })
                    .collect();
                v.sort_by(|a, b| a.dispositivo.cmp(&b.dispositivo));
                v
            })
            .unwrap_or_default();
        QueueView { pendientes: cuenta("pendiente"), en_curso: cuenta("en_curso"), trabajadores }
    }

    // ---- interno ----

    fn lanzar_uno(&self, dispositivo: &str) {
        let log = self
            .dir
            .join("workers")
            .join(format!("{}.log", dispositivo.replace(':', "-")));
        match worker::spawn(
            dispositivo.to_string(),
            &self.python,
            &self.script,
            log,
            self.eventos.clone(),
        ) {
            Ok(l) => {
                if let Ok(mut e) = self.estado.lock() {
                    e.trabajadores.insert(
                        dispositivo.to_string(),
                        Vivo {
                            modelo: None,
                            trabajo: None,
                            listo: false,
                            desde: Instant::now(),
                            tx: l.trabajos,
                            matar: Some(l.matar),
                        },
                    );
                }
                tracing::info!("trabajador lanzado en {dispositivo}");
            }
            Err(err) => {
                tracing::error!("no se pudo lanzar el trabajador de {dispositivo}: {err}");
                // Que ni siquiera arranque cuenta como fallo para la espera: si
                // no, un script borrado daría vueltas en bucle cerrado.
                self.apuntar_fallo(dispositivo);
            }
        }
    }

    /// Anota que este dispositivo ha fallado y cuándo se puede reintentar. La
    /// espera se dobla en cada intento hasta el tope.
    fn apuntar_fallo(&self, dispositivo: &str) {
        if let Ok(mut e) = self.estado.lock() {
            let (_, veces) = e.reintento.get(dispositivo).copied().unwrap_or((Instant::now(), 0));
            let veces = veces.saturating_add(1);
            let espera = (RELANZAR_MIN_S << veces.min(5)).min(RELANZAR_MAX_S);
            e.reintento.insert(
                dispositivo.to_string(),
                (Instant::now() + std::time::Duration::from_secs(espera), veces),
            );
        }
    }

    /// Relanza a los ausentes y mata a los que llevan demasiado sin decir
    /// `listo`. Sin esto, un trabajador que muere o que se cuelga cargando
    /// pesos deja su dispositivo perdido hasta que alguien reinicie el daemon.
    fn revisar(&self) {
        let plazo = std::time::Duration::from_secs(
            self.store
                .get_meta("queue_listo_s")
                .and_then(|v| v.parse().ok())
                .unwrap_or(LISTO_S),
        );
        let ahora_i = Instant::now();

        // Los que se quedaron cargando para siempre. Se matan y su `Muerto`
        // hará el resto por el camino normal.
        let colgados: Vec<oneshot::Sender<()>> = match self.estado.lock() {
            Ok(mut e) => e
                .trabajadores
                .values_mut()
                .filter(|w| !w.listo && ahora_i.duration_since(w.desde) > plazo)
                .filter_map(|w| w.matar.take())
                .collect(),
            Err(_) => return,
        };
        for m in colgados {
            let _ = m.send(());
        }

        // Y los que faltan, si les toca.
        let faltan: Vec<String> = match self.estado.lock() {
            Ok(e) => self
                .dispositivos
                .iter()
                .filter(|d| !e.trabajadores.contains_key(*d))
                .filter(|d| e.reintento.get(*d).map(|(c, _)| ahora_i >= *c).unwrap_or(true))
                .cloned()
                .collect(),
            Err(_) => return,
        };
        for d in faltan {
            self.apuntar_fallo(&d);
            self.lanzar_uno(&d);
        }
    }

    async fn bucle(
        self: Arc<Self>,
        mut rx_avisos: mpsc::UnboundedReceiver<()>,
        mut rx_ev: mpsc::UnboundedReceiver<Evento>,
    ) {
        loop {
            tokio::select! {
                Some(ev) = rx_ev.recv() => self.aplicar(ev),
                Some(_) = rx_avisos.recv() => {}
                _ = tokio::time::sleep(std::time::Duration::from_secs(TICK_S)) => {}
            }
            self.revisar();
            self.repartir_ahora();
        }
    }

    /// ¿Este trabajador tiene de verdad este trabajo en la mano?
    ///
    /// Un trabajador confundido podría contestar por un `id` que nunca se le
    /// dio —el de otro dispositivo, o uno ya terminado— y machacar un resultado
    /// bueno. Se ignora y se registra: al trabajador se le cree el log, no los
    /// datos, y eso vale también para los identificadores.
    fn es_suyo(&self, dispositivo: &str, id: i64) -> bool {
        let suyo = self
            .estado
            .lock()
            .map(|e| e.trabajadores.get(dispositivo).and_then(|w| w.trabajo) == Some(id))
            .unwrap_or(false);
        if !suyo {
            tracing::warn!("[{dispositivo}] contestó por el trabajo {id}, que no es suyo");
        }
        suyo
    }

    fn aplicar(&self, ev: Evento) {
        match ev {
            Evento::Listo { dispositivo, modelo } => {
                if let Ok(mut e) = self.estado.lock() {
                    if let Some(w) = e.trabajadores.get_mut(&dispositivo) {
                        w.listo = true;
                        w.modelo = modelo;
                    }
                    // Arrancó bien: la espera creciente vuelve a cero. Si no,
                    // un dispositivo que falló tres veces hace una hora seguiría
                    // esperando un minuto para relanzarse la próxima vez.
                    e.reintento.remove(&dispositivo);
                }
            }
            Evento::Progreso { dispositivo, id, fase, pct } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                // NO se escribe. Se emite y se olvida: persistir cada línea de
                // progreso es lo único que rompería el mutex único de SQLite.
                if let Some((user_id, _)) = self.dueno_y_caso(id) {
                    let _ = self.difusion.send(Cambio::Progreso {
                        user_id,
                        analysis_id: id,
                        fase,
                        pct,
                    });
                }
            }
            Evento::Resultado { dispositivo, id, lat, lng, radio_m, confianza } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'hecho', error = NULL, result_lat = ?2,
                            result_lng = ?3, result_radius_m = ?4, result_confidence = ?5,
                            finished_at = ?6
                     WHERE id = ?1",
                    rusqlite::params![id, lat, lng, radio_m, confianza, ahora()],
                );
                self.soltar(&dispositivo, id);
                self.anunciar(id, "hecho");
            }
            Evento::Fallo { dispositivo, id, motivo } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'error', error = ?2, finished_at = ?3
                     WHERE id = ?1",
                    rusqlite::params![id, motivo, ahora()],
                );
                self.soltar(&dispositivo, id);
                self.anunciar(id, "error");
            }
            Evento::Muerto { dispositivo } => self.enterrar(&dispositivo),
        }
    }

    /// El trabajador se murió. Lo que tenía en la mano no es culpa suya, así que
    /// vuelve a la cola — pero con tope: sin él, una imagen envenenada tumbaría
    /// a la misma GPU en bucle para siempre.
    fn enterrar(&self, dispositivo: &str) {
        let trabajo = match self.estado.lock() {
            Ok(mut e) => e.trabajadores.remove(dispositivo).and_then(|w| w.trabajo),
            Err(_) => None,
        };
        tracing::error!("el trabajador de {dispositivo} ha muerto");
        let Some(id) = trabajo else { return };

        let veces: i64 = self
            .store
            .conn()
            .query_row("SELECT requeues FROM analyses WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or(0);
        if veces >= MAX_REQUEUES {
            let _ = self.store.conn().execute(
                "UPDATE analyses SET state = 'error', error = ?2, finished_at = ?3 WHERE id = ?1",
                rusqlite::params![
                    id,
                    "el trabajador murió dos veces con este trabajo",
                    ahora()
                ],
            );
            self.anunciar(id, "error");
        } else {
            let _ = self.store.conn().execute(
                "UPDATE analyses SET state = 'pendiente', requeues = requeues + 1 WHERE id = ?1",
                [id],
            );
            self.anunciar(id, "pendiente");
        }
    }

    fn soltar(&self, dispositivo: &str, id: i64) {
        if let Ok(mut e) = self.estado.lock() {
            if let Some(w) = e.trabajadores.get_mut(dispositivo) {
                if w.trabajo == Some(id) {
                    w.trabajo = None;
                }
            }
        }
    }

    fn dueno_y_caso(&self, analysis_id: i64) -> Option<(i64, i64)> {
        self.store
            .conn()
            .query_row(
                "SELECT requested_by, case_id FROM analyses WHERE id = ?1",
                [analysis_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok()
    }

    fn anunciar(&self, analysis_id: i64, estado: &str) {
        if let Some((user_id, case_id)) = self.dueno_y_caso(analysis_id) {
            let _ = self.difusion.send(Cambio::Estado {
                user_id,
                analysis_id,
                case_id,
                estado: estado.to_string(),
            });
        }
    }

    fn repartir_ahora(&self) {
        let libres: Vec<Libre> = match self.estado.lock() {
            Ok(e) => e
                .trabajadores
                .iter()
                .filter(|(_, w)| w.listo && w.trabajo.is_none())
                .map(|(d, w)| Libre { dispositivo: d.clone(), modelo: w.modelo.clone() })
                .collect(),
            Err(_) => return,
        };
        if libres.is_empty() {
            return;
        }

        let candidatos = self.candidatos();
        if candidatos.is_empty() {
            return;
        }
        let duenos = self.duenos(&candidatos);

        for a in plan::repartir(&candidatos, &duenos, &libres) {
            let Some(imagenes) = self.rutas(a.analysis_id) else { continue };
            let Some(modelo) = candidatos
                .iter()
                .find(|c| c.analysis_id == a.analysis_id)
                .map(|c| c.modelo.clone())
            else {
                continue;
            };

            // Se marca ANTES de mandarlo: si el trabajador muere entre el
            // UPDATE y el envío, `enterrar` lo devuelve a la cola. Al revés se
            // perdería sin dejar rastro.
            let marcado = self
                .store
                .conn()
                .execute(
                    "UPDATE analyses SET state = 'en_curso' WHERE id = ?1 AND state = 'pendiente'",
                    [a.analysis_id],
                )
                .unwrap_or(0);
            if marcado == 0 {
                continue;
            }

            let enviado = match self.estado.lock() {
                Ok(mut e) => match e.trabajadores.get_mut(&a.dispositivo) {
                    Some(w) => {
                        w.trabajo = Some(a.analysis_id);
                        w.tx.send(Job::nuevo(a.analysis_id, modelo, imagenes)).is_ok()
                    }
                    None => false,
                },
                Err(_) => false,
            };
            if enviado {
                self.anunciar(a.analysis_id, "en_curso");
            } else {
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'pendiente' WHERE id = ?1",
                    [a.analysis_id],
                );
            }
        }
    }

    fn candidatos(&self) -> Vec<Candidato> {
        let c = self.store.conn();
        let Ok(mut q) = c.prepare(
            "SELECT id, requested_by, model, created_at FROM analyses
             WHERE state = 'pendiente' ORDER BY created_at",
        ) else {
            return vec![];
        };
        q.query_map([], |r| {
            Ok(Candidato {
                analysis_id: r.get(0)?,
                user_id: r.get(1)?,
                modelo: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    }

    fn duenos(&self, candidatos: &[Candidato]) -> HashMap<i64, Dueno> {
        let presentes = self
            .estado
            .lock()
            .map(|e| e.presentes.keys().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        let mut out = HashMap::new();
        for uid in candidatos.iter().map(|c| c.user_id).collect::<std::collections::HashSet<_>>() {
            // `limits::effective` y no la tabla: la precedencia de dos niveles
            // vive ahí y en un solo sitio.
            let l = limits::effective(&self.store, uid);
            let bloqueado: bool = self
                .store
                .conn()
                .query_row("SELECT blocked FROM users WHERE id = ?1", [uid], |r| {
                    r.get::<_, i64>(0)
                })
                .map(|b| b == 1)
                .unwrap_or(true);
            let en_curso: i64 = self
                .store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND state = 'en_curso'",
                    [uid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            out.insert(
                uid,
                Dueno {
                    bloqueado,
                    conectado: presentes.contains(&uid),
                    segundo_plano: l.background_jobs,
                    max_concurrent: l.max_concurrent,
                    prioridad: l.queue_priority,
                    en_curso,
                },
            );
        }
        out
    }

    /// Las rutas de las imágenes del análisis. `None` si le falta alguna: mejor
    /// dejarlo pendiente que mandar un trabajo incompleto.
    fn rutas(&self, analysis_id: i64) -> Option<Vec<String>> {
        let c = self.store.conn();
        let mut q = c
            .prepare(
                "SELECT ca.project_id, i.id FROM analysis_images ai
                 JOIN images i ON i.id = ai.image_id
                 JOIN cases ca ON ca.id = i.case_id
                 WHERE ai.analysis_id = ?1",
            )
            .ok()?;
        let filas: Vec<(i64, i64)> = q
            .query_map([analysis_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()?
            .flatten()
            .collect();
        if filas.is_empty() {
            return None;
        }
        // El mismo reparto que `images::dir_for`: `{DATA}/projects/<id>/<imagen>`.
        Some(
            filas
                .into_iter()
                .map(|(p, i)| self.dir.join("projects").join(p.to_string()).join(i.to_string()))
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        )
    }
}
```

- [ ] **Step 3: Enchufarla al arranque**

En `crates/lumid/src/main.rs`, añadir el campo a `App` después de `sysinfo`:

```rust
    /// La cola vive tanto como el daemon. Sus trabajadores son procesos hijo
    /// con `kill_on_drop`, así que mueren con él y no dejan VRAM ocupada.
    pub queue: Arc<queue::Queue>,
}
```

Y en `async fn main`, sustituir la construcción de `App` por esto (el `store` y los `gpus` se
sacan antes porque la cola los necesita):

```rust
    let store = Arc::new(store::Store::open(&dir)?);
    let gpus = gpus();
    let queue = queue::Queue::arrancar(store.clone(), dir.clone(), &gpus);
    let app = App {
        store,
        fingerprint,
        mode: if std::path::Path::new("/.dockerenv").exists() { Mode::Docker } else { Mode::Native },
        gpus,
        master: Arc::new(RwLock::new(master::load_at_boot(&dir))),
        dir: dir.clone(),
        sysinfo: Arc::new(Mutex::new(sysinfo::System::new_all())),
        queue,
    };
```

- [ ] **Step 4: Compilar**

Run: `cargo test -p lumid -p lumi-proto`
Expected: PASS, todas las pruebas anteriores siguen en verde y no hay avisos de código sin usar.

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/queue/mod.rs crates/lumid/src/main.rs crates/lumi-proto/src/api.rs
git commit -m "La cola reparte, apunta lo que vuelve y entierra a sus muertos"
```

---

### Task 7: Presencia, SSE y telemetría de verdad

**Files:**
- Create: `crates/lumid/src/routes/queue.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs` (dos rutas)
- Modify: `crates/lumid/src/telemetry.rs`

**Interfaces:**
- Consumes: `Queue::{suscribir, entra, foto, profundidad, hay_trabajadores}` de la tarea 6.
- Produces: `GET /v1/queue/events` (SSE, cualquier sesión) y `GET /v1/queue` (JSON `QueueView`, solo administrador).

- [ ] **Step 1: Escribir las rutas**

Crear `crates/lumid/src/routes/queue.rs`:

```rust
//! El canal por el que el cliente se entera de sus resultados.
//!
//! Y, de paso, la presencia: mientras este flujo está abierto, su dueño cuenta
//! como conectado. No hace falta ni una ventana heurística sobre `last_seen` ni
//! una escritura por petición — que es justo lo que el subsistema 2 rechazó a
//! propósito al documentar `require_session`.

use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use lumi_proto::api::QueueView;
use std::convert::Infallible;
use tokio::sync::broadcast::error::RecvError;

pub async fn events(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let (uid, _) = require_session(&app, &bearer(&headers))?;
    let mut rx = app.queue.suscribir();
    let presencia = app.queue.entra(uid);

    let stream = async_stream::stream! {
        // La presencia se suelta exactamente cuando este flujo se cierra, sea
        // porque cerró la app o porque se cayó la red. No hay nada que limpiar
        // a mano ni un temporizador que pueda quedarse corto o largo.
        let _presencia = presencia;
        loop {
            match rx.recv().await {
                Ok(c) if c.user_id() == uid => {
                    yield Ok(Event::default().json_data(&c).unwrap_or_default());
                }
                Ok(_) => {}
                // Un cliente lento se pierde eventos antiguos y sigue con los
                // nuevos. Cortarle el flujo por ir tarde sería peor: perdería
                // también la presencia.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break,
            }
        }
    };
    // El latido importa aquí más que en ningún otro sitio: un proxy que corte
    // conexiones inactivas haría que alguien delante de la pantalla pareciera
    // desconectado y le pausaría su propio trabajo.
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub async fn view(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<QueueView>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(app.queue.foto()))
}
```

- [ ] **Step 2: Declarar el módulo y las rutas**

En `crates/lumid/src/routes/mod.rs`, junto a los otros:

```rust
pub mod queue;
```

En `crates/lumid/src/main.rs`, después de la línea de `/v1/telemetry`:

```rust
        .route("/v1/queue/events", get(routes::queue::events))
        .route("/v1/queue", get(routes::queue::view))
```

- [ ] **Step 3: Dar sentido a la telemetría**

En `crates/lumid/src/telemetry.rs`, sustituir el bloque final de `Sample`:

```rust
    Sample {
        gpus,
        cpu_pct,
        ram_used_mb,
        disk_free_mb,
        queue_depth: app.queue.profundidad(),
        // «Pausada» quiere decir que no está repartiendo, y la única razón por
        // la que puede no repartir es no tener ni un trabajador listo. Antes
        // esto miraba la clave maestra, sobre la premisa de que las imágenes
        // estaban cifradas en reposo — y todavía no lo están.
        queue_paused: !app.queue.hay_trabajadores(),
    }
```

- [ ] **Step 4: Compilar**

Run: `cargo test -p lumid -p lumi-proto`
Expected: PASS, sin avisos.

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/routes/queue.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs crates/lumid/src/telemetry.rs
git commit -m "El SSE de la cola, que ademas es la senal de presencia"
```

---

### Task 8: No se toca lo que está corriendo

**Files:**
- Modify: `crates/lumid/src/routes/analyses.rs`
- Modify: `crates/lumid/src/routes/images.rs`

**Interfaces:**
- Consumes: `App.queue` de la tarea 6.
- Produces: `DELETE /v1/analyses/:id` y `DELETE /v1/images/:id` devuelven `409 CONFLICT` cuando hay un análisis `en_curso` de por medio.

- [ ] **Step 1: Avisar a la cola al crear un análisis**

En `crates/lumid/src/routes/analyses.rs`, en `pub async fn create`, sustituir la línea del
`tracing::info!` por:

```rust
    // Sin esto el trabajo esperaría al tic de dos segundos de la cola. Con
    // esto sale hacia una GPU en cuanto hay una libre.
    app.queue.avisar();
    tracing::info!("análisis #{id} encolado (modelo {})", req.model);
```

- [ ] **Step 2: Rechazar el borrado de lo que corre**

En el mismo archivo, en `pub async fn remove`, sustituir la consulta inicial y añadir la
guarda:

```rust
    let (case_id, state): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, state FROM analyses WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
    // Cancelar es esto: borrar lo que todavía no ha empezado. Lo que ya está en
    // una GPU llega hasta el final — matarlo tiraría cómputo ya gastado.
    if state == "en_curso" {
        return Err(err(
            StatusCode::CONFLICT,
            "este análisis ya se está ejecutando; no se puede cancelar a mitad",
        ));
    }
```

- [ ] **Step 3: Proteger las imágenes en uso**

En `crates/lumid/src/routes/images.rs`, en `pub async fn remove`, justo después de la
comprobación de permisos del caso y antes de borrar los archivos:

```rust
    // Si se fuera, el resultado aterrizaría sobre un caso al que le falta la
    // prueba que lo produjo. En una herramienta forense eso no es aceptable.
    let en_uso: i64 = app
        .store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM analysis_images ai JOIN analyses a ON a.id = ai.analysis_id
             WHERE ai.image_id = ?1 AND a.state = 'en_curso'",
            [id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if en_uso > 0 {
        return Err(err(
            StatusCode::CONFLICT,
            "esta imagen se está analizando ahora mismo; espera a que termine",
        ));
    }
```

- [ ] **Step 4: Compilar**

Run: `cargo test -p lumid -p lumi-proto`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/routes/analyses.rs crates/lumid/src/routes/images.rs
git commit -m "Lo que ya corre no se cancela ni se le quitan las pruebas"
```

---

### Task 9: El cliente

El dock ya dibuja las tres situaciones de un trabajo. Solo hay que darle datos que cambien.

**Files:**
- Modify: `client/src-tauri/src/main.rs`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/work/CaseView.tsx`

**Interfaces:**
- Consumes: `GET /v1/queue/events` de la tarea 7.
- Produces: el comando de Tauri `start_queue_events(token)`, que emite los eventos `queue-change` (con el JSON del `Cambio`) y `queue-down`.

- [ ] **Step 1: Puente SSE en Tauri**

En `client/src-tauri/src/main.rs`, después de `start_task_log`:

```rust
/// El SSE de la cola, reemitido como evento de Tauri.
///
/// El webview no puede usar `EventSource`: no sabe poner la cabecera de
/// autorización, y el esquema `lumi://` devuelve respuestas completas, no
/// flujos. Se hace igual que la telemetría, con el mismo bucle de reconexión.
///
/// Y hay una razón de más para reconectar: mientras esta conexión está abierta,
/// el daemon cuenta a esta persona como presente. Un hueco aquí es un hueco en
/// su presencia, y con el segundo plano apagado eso le pausa su propio trabajo.
#[tauri::command]
async fn start_queue_events(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        loop {
            let res = client.get(format!("{base}/v1/queue/events")).bearer_auth(&token).send().await;
            let Ok(res) = res else {
                let _ = app.emit("queue-down", ());
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            };
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(i) = buf.find("\n\n") {
                    let frame = buf[..i].to_string();
                    buf.drain(..i + 2);
                    if let Some(d) = frame.strip_prefix("data: ") {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                            let _ = app.emit("queue-change", v);
                        }
                    }
                }
            }
            let _ = app.emit("queue-down", ());
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
    Ok(())
}
```

Y añadirlo a la lista del `invoke_handler`, junto a `start_telemetry`:

```rust
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            start_queue_events,
```

(mantener el resto de la lista tal como está).

- [ ] **Step 2: Los tipos en el cliente**

En `client/src/lib/api.ts`, dentro de `export interface Limits`, después de `queue_priority`:

```ts
  /** Si su trabajo pendiente sigue avanzando cuando se desconecta. */
  background_jobs: boolean;
```

Y al final del archivo, antes de la constante `call`:

```ts
/** Lo que llega por el evento `queue-change`. El progreso no está guardado en
 *  ninguna parte: se emite y se olvida, así que si te lo pierdes, se perdió. */
export type Cambio =
  | { tipo: "estado"; analysis_id: number; case_id: number; estado: Analysis["state"] }
  | { tipo: "progreso"; analysis_id: number; fase: string; pct: number };
```

- [ ] **Step 3: Abrir el flujo al entrar**

En `client/src/App.tsx`, junto a la llamada que ya existe a `start_telemetry` tras iniciar
sesión (hay una en `App.tsx` y otra en `wizard/AdminStep.tsx`), añadir en **ambos** sitios,
inmediatamente después:

```tsx
            // Abrir el flujo de la cola es también anunciarse como presente:
            // mientras esté abierto, el trabajo pendiente de esta persona
            // cuenta como el de alguien que está mirando.
            await invoke("start_queue_events", { token: session.token });
```

En `wizard/AdminStep.tsx` el token está en `res.token`, así que allí la línea es
`await invoke("start_queue_events", { token: res.token });`.

- [ ] **Step 4: Escuchar en la vista de caso**

En `client/src/work/CaseView.tsx`, añadir el import:

```tsx
import { listen } from "@tauri-apps/api/event";
import type { Cambio } from "../lib/api";
```

Y un efecto nuevo, justo después del `useEffect(() => { void load(); }, [case_.id]);`:

```tsx
  // Antes esto solo se leía al montar: un análisis lanzado se quedaba
  // «pendiente» en pantalla para siempre aunque el servidor ya lo hubiera
  // resuelto. Ahora el servidor avisa.
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "estado" || c.case_id !== case_.id) return;
      // Se recarga en vez de parchear la fila: el cambio de estado trae
      // coordenadas, radio y confianza, y reconstruirlos aquí sería duplicar
      // lo que la ruta ya sabe montar.
      void load();
    });
    return () => { void un.then((f) => f()); };
  }, [case_.id]);
```

- [ ] **Step 5: Quitar el resultado falso**

En `client/src/dev/DebugOrb.tsx` vive el único uso: el comando `fake <id>` del orbe de
depuración. Borrar las tres ramas que lo mencionan (las de las líneas 30, 39 y la mención en
el `placeholder` de la 53), dejando el resto de comandos del orbe intactos — `env` y `reset`
siguen siendo útiles.

En `crates/lumid/src/routes/analyses.rs`, borrar la función `pub async fn fake` completa junto
con su atributo `#[cfg(debug_assertions)]` y el comentario de documentación que la precede. En
`crates/lumid/src/main.rs`, borrar el bloque:

```rust
    #[cfg(debug_assertions)]
    let router = router.route("/v1/analyses/:id/fake", axum::routing::patch(routes::analyses::fake));
```

- [ ] **Step 6: Verificar que no queda nada**

Run:
```bash
grep -rn "fake" client/src crates/lumid/src; echo "salida $? (1 = limpio)"
```
Expected: `salida 1 (1 = limpio)`.

- [ ] **Step 7: Compilar las dos mitades**

Run: `cargo test -p lumid -p lumi-proto && cd client && npm run build`
Expected: las pruebas en verde y `✓ built` sin errores de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add client crates/lumid/src/routes/analyses.rs crates/lumid/src/main.rs
git commit -m "El cliente se entera solo, y el resultado falso ya no hace falta"
```

---

### Task 10: Documentación

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `FUTURO.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documentación al día.

- [ ] **Step 1: Actualizar el estado en ARCHITECTURE.md**

En la tabla de §5, cambiar la fila del subsistema 4:

```markdown
| **4** | **Cola y planificador** | Cientos de usuarios, pausa por desconexión, prioridades, multi-GPU y GPU+CPU | **Terminado** |
```

En §10, sustituir el párrafo **Base de datos** por:

```markdown
**Base de datos. Revisado en el subsistema 4: SQLite se queda.** Un análisis son unas tres
escrituras (a `en_curso`, el resultado, el cierre); con ocho GPUs y trabajos de treinta
segundos eso es menos de una escritura por segundo y el mutex ni se entera. La condición bajo
la que esto se sostiene está escrita en el código y hay que respetarla: **el progreso de un
trabajo no se persiste nunca**, se retransmite por el SSE y se olvida. El día que alguien lo
guarde, esta decisión deja de valer.
```

Y sustituir el párrafo **Frontera Rust↔Python** por:

```markdown
**Frontera Rust↔Python: definida en el subsistema 4.** JSON por líneas sobre las tuberías
estándar de un proceso hijo; los tipos viven en `lumi-proto::worker` y el trabajador de
referencia, en `workers/lumi_worker.py`. El subsistema 5 sustituye `_cargar` y `_resolver` de
ese archivo sin tocar el daemon.
```

Y el de **Bloquear a un usuario**:

```markdown
**Bloquear a un usuario no detiene sus trabajos ya encolados, y ahora se sabe qué hace.** El
planificador nunca elige un trabajo de alguien bloqueado, así que lo pendiente se queda
quieto; lo que ya estuviera corriendo termina. No se borra nada: bloquear puede ser temporal
y destruir su cola sería irreversible.
```

- [ ] **Step 2: Documentar en README.md**

Añadir una sección después de la del subsistema 6:

```markdown
### Cola y planificador (subsistema 4)

Los análisis ya no se quedan en `pendiente`. Un trabajador por dispositivo —una GPU, o la CPU
si no hay ninguna— arranca con el daemon y se mantiene vivo entre trabajos con los pesos
cargados. La cola los reparte con esta política, en este orden: primero descarta lo que no
puede correr (dueño bloqueado, dueño desconectado sin `background_jobs`, dueño en su
`max_concurrent`), y luego ordena lo que queda por conectado antes que segundo plano,
`queue_priority` y llegada.

**Lo que ya corre nunca se cancela.** `DELETE /v1/analyses/:id` cancela lo pendiente y
devuelve 409 sobre lo que está en una GPU; lo mismo `DELETE /v1/images/:id` con una imagen que
se está analizando.

| Ruta | Quién | Qué |
|---|---|---|
| `GET /v1/queue/events` | cualquier sesión | SSE con los cambios de sus análisis. Mientras está abierto, cuenta como conectado |
| `GET /v1/queue` | administrador | Pendientes, en curso y estado de cada trabajador |

**El motor todavía no existe** (subsistema 5): `workers/lumi_worker.py` devuelve una
coordenada fija. Es el trabajador de referencia y también la documentación ejecutable del
contrato — quien escriba otro, lo lee.
```

- [ ] **Step 3: Poner al día FUTURO.md**

Sustituir la entrada *Análisis multi-imagen en la interfaz* por:

```markdown
### Análisis multi-imagen en la interfaz

El esquema y el protocolo ya lo soportan: `analysis_images` es una tabla intermedia desde el
primer día y el campo `imagenes` del contrato con el trabajador es una lista. Falta la
interfaz — seleccionar varias tomas de la misma escena y lanzarlas como una unidad.

La duda que quedaba aquí, qué hace la cola cuando una unidad compuesta falla a medias, la
resolvió el subsistema 4: **no falla a medias**. El análisis es la unidad de trabajo, sus
imágenes van juntas al mismo trabajador en la misma línea y vuelve un resultado o un fallo.
Cuando la interfaz lo ofrezca, la cola no cambia.
```

Y añadir tres entradas nuevas en la sección *Transversales*:

```markdown
### Trabajadores en otra máquina

Hoy los trabajadores son procesos hijo del daemon y mueren con él, que es lo que evita
puertos abiertos y procesos huérfanos con la VRAM ocupada. El día que haya varias máquinas de
inferencia, esto se convierte en un servicio con autenticación entre daemon y trabajador, o en
un broker de verdad. No antes: sería infraestructura que instalar, vigilar y explicar en el
asistente para un servidor que es una sola máquina.

### Cifrado de imágenes en reposo

La maquinaria existe desde el subsistema 1 (`crypto::seal`/`open`, clave por proyecto) pero
`images.rs` no la usa: las imágenes están en claro en `{DATA}/projects/<proyecto>/<imagen>`. El
día que se cifren hay que revisar la regla del subsistema 4 de mandar **rutas y no bytes** a
los trabajadores, porque un trabajador no tendrá la clave.

### Reparto justo por turnos en la cola

El planificador ordena por prioridad y llegada, y confía en `max_concurrent` como antídoto
contra la inanición: quien tiene prioridad alta ocupa su cupo y ni un sitio más. Si con
cientos de usuarios reales eso resulta insuficiente, la salida es un reparto por turnos entre
usuarios, y cabe entero dentro de `queue/plan.rs` sin tocar el contrato ni la cola.

### Cambio de modelo en bucle con una sola GPU

Con un único dispositivo y dos personas alternando modelos, cargar pesos puede dominar el
tiempo total. Con varias GPUs no pasa, porque preferir al que ya tiene el modelo cargado las
especializa solas. La salida, si duele, es agrupar los candidatos por modelo antes de
repartir: un cambio dentro de `plan.rs`.
```

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md README.md FUTURO.md
git commit -m "Documentar la cola y cerrar las dudas que arrastraba"
```

---

## Verificación final

- [ ] `cargo test -p lumid -p lumi-proto` — cinco pruebas nuevas más las que ya había, todas en verde.
- [ ] `cd client && npm run build` — sin errores de TypeScript.
- [ ] `grep -rn "fake" client/src crates/lumid/src` — sin resultados.
- [ ] Con el daemon corriendo: subir una imagen, lanzar un análisis y ver que pasa de
      `pendiente` a `en_curso` y a `hecho` **sin recargar la aplicación**, con el punto en el
      mapa donde el trabajador de referencia dice (43.3612, −8.4104).
- [ ] Cerrar la aplicación con un análisis pendiente y `background_jobs` apagado: al volver a
      abrirla, ese análisis sigue pendiente y arranca solo.
- [ ] `curl` autenticado a `/v1/queue` como administrador: enseña un trabajador por GPU (o uno
      de CPU si no hay ninguna) con su modelo cargado.
- [ ] Matar a mano un trabajador (`pkill -f lumi_worker.py`) y comprobar en `/v1/queue` que
      vuelve solo en unos segundos, y que el trabajo que tuviera en la mano vuelve a
      `pendiente` en vez de quedarse en `en_curso`.
- [ ] Lanzar el daemon con `LUMI_FAKE_LOAD_S=999` en el entorno y `queue_listo_s` a `5` en
      `meta`: el trabajador se mata solo por no decir `listo` a tiempo, y se relanza con
      esperas cada vez más largas en lugar de en bucle cerrado.
