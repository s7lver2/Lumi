# Darkroom 2 · 3 — Infraestructura de herramientas: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear la infraestructura común para que Darkroom pueda declarar, comprobar y ejecutar herramientas de investigación con workers locales, modelos con presupuesto de VRAM, servicios externos auditables, auditoría IA calibrada y pistas de región confirmables.

**Architecture:** Se amplían los contratos ya existentes en `lumi-proto` y la cola de `lumid`; el registro de herramientas es la autoridad de tipos, resultados y requisitos. La ejecución continúa en procesos hijos JSON-lines, pero se etiqueta por herramienta y queda mediada por el daemon: solo él reserva modelos, persiste resultados, hace llamadas externas y escribe en la bitácora. El cliente consulta una matriz de capacidades en vez de inferir disponibilidad.

**Tech Stack:** Rust (axum, rusqlite, tokio, serde) en `crates/lumid` y `crates/lumi-proto`; TypeScript/React en `client/`; registros JSON existentes en `registros/`.

**Spec:** `docs/superpowers/specs/2026-09-22-darkroom2-03-infraestructura-herramientas-design.md`

## Global Constraints

- Una fuente solo se crea para una combinación de tipo y herramienta registrada y disponible.
- Los workers no escriben SQLite, no llaman directamente a internet y no cambian `revision`.
- Mini/Pro/Vision respetan presupuestos de 8/12/24+ GB de VRAM; un modelo prestado nunca se descarga.
- Cada servicio externo requiere habilitación y credencial de administrador; cada envío y respuesta se anotan en la bitácora del caso.
- Los módulos activos nacen deshabilitados y requieren confirmación por ejecución.
- El auditor solo devuelve `probable`, `no_concluyente`, `probable_falso_positivo` o `abstencion`; jamás confirma ni descarta por la persona.
- Una calibración caduca al cambiar modelo, versión o esquema de prompt.
- Las pistas de región solo reponderan hipótesis después de confirmación humana.
- No se descargan ni incorporan modelos con licencias pendientes de verificar.
- Idioma español en copy, comentarios y commits.

## Review Focus

- Una fuente creada mientras cambia una capacidad debe ser rechazada por el servidor y no dejar una fila/cola huérfana.
- Un worker que emite JSON inválido, un resultado de otra herramienta o coordenadas imposibles debe fallar sin corromper resultados.
- Dos tareas concurrentes que necesitan VRAM no pueden descargar el modelo que la otra ya ha reservado.
- Una llamada externa debe registrar exactamente los campos enviados, pero nunca claves ni cuerpos completos potencialmente personales.
- Una salida de IA no calibrada, caducada o con un veredicto fuera del enum no puede presentarse como auditoría disponible.

---

### Task 1: Registro tipado y matriz de capacidades

**Files:**
- Create: `crates/lumid/src/herramientas.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Create: `crates/lumid/src/routes/capacidades.rs`
- Modify: `crates/lumid/src/main.rs`
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `crates/lumid/src/routes/sources.rs`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/work/darkroom/AñadirFuente.tsx`
- Test: `crates/lumid/src/herramientas.rs`

**Interfaces:**
- Consumes: `sources` y `resultados` del spec Darkroom2-02; `Queue` y registros ya cargados por `app.queue`.
- Produces: `herramientas::registro()`, `herramientas::capacidad(&App, tool, level) -> Capacidad`, `GET /v1/capacidades` y tipos `Capacidad`, `EstadoCapacidad`.

- [ ] **Step 1: Escribir los tests de registro antes de implementarlo**

En `crates/lumid/src/herramientas.rs`, crear pruebas que fijan los invariantes mínimos:

```rust
#[test]
fn geolocalizar_admite_imagen_y_no_telefono() {
    let geo = registro().iter().find(|h| h.id == "geolocalizar").unwrap();
    assert!(geo.tipos.contains(&"imagen"));
    assert!(!geo.tipos.contains(&"telefono"));
}

#[test]
fn una_herramienta_desconocida_no_es_disponible() {
    assert!(buscar("no-existe").is_none());
}
```

- [ ] **Step 2: Ejecutar los tests y confirmar que fallan**

Run: `cargo test -p lumid herramientas::tests -- --nocapture`

Expected: FAIL porque `registro` y `buscar` todavía no existen.

- [ ] **Step 3: Implementar el registro como autoridad única**

Crear `herramientas.rs` con tipos serializables que no dependan de componentes React:

```rust
pub struct Herramienta {
    pub id: &'static str,
    pub nombre: &'static str,
    pub tipos: &'static [&'static str],
    pub requiere_modelos: &'static [&'static str],
    pub requiere_externo: &'static [&'static str],
    pub admite_auditor: bool,
}

pub fn registro() -> &'static [Herramienta] { /* geolocalizar por ahora */ }
pub fn buscar(id: &str) -> Option<&'static Herramienta> { registro().iter().find(|h| h.id == id) }
```

No registrar OSINT ni Car ID todavía: sus specs añaden sus entradas cuando su worker y sus tipos existan. Extraer de `sources.rs` cualquier lista fija de combinaciones válidas y hacer que valide con `buscar` + `tipos`.

- [ ] **Step 4: Añadir tipos de API y resolver capacidades**

En `lumi-proto::api`, añadir:

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EstadoCapacidad { Disponible, NoInstalado, SinVram, SinServicio, Deshabilitado, NoCompatible }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Capacidad { pub herramienta: String, pub nivel: String, pub estado: EstadoCapacidad, pub motivo: String }
```

`capacidad` revisa en este orden: herramienta/tipo válido, modelos instalados con el criterio existente `LICENCIA.txt`, reserva posible y servicios configurados. Devolver el primer bloqueo humano-accionable; nunca un booleano opaco.

- [ ] **Step 5: Exponer y consumir la matriz**

Crear `routes/capacidades.rs`, exigir sesión válida y servir `GET /v1/capacidades`. Registrarlo en `routes/mod.rs` y `main.rs`. En `client/src/lib/api.ts` reproducir la unión exacta de estados. En `AñadirFuente.tsx`, sustituir condiciones locales por la respuesta: cada opción bloqueada sigue visible con `motivo` como texto y `title`.

- [ ] **Step 6: Verificar**

Run: `cargo test -p lumid herramientas::tests && cargo build -p lumid -p lumi-proto && cd client && npx tsc -b --noEmit && npm run lint`

Expected: PASS. Verificación manual: un modelo ausente aparece como «Falta instalar …» y una combinación no registrada no llega a `POST /sources`.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/herramientas.rs crates/lumid/src/routes/{mod.rs,capacidades.rs,sources.rs} crates/lumid/src/main.rs crates/lumi-proto/src/api.rs client/src/lib/api.ts client/src/work/darkroom/AñadirFuente.tsx
git commit -m "feat(darkroom): registro de herramientas y matriz de capacidades"
```

---

### Task 2: Contrato extensible de worker y persistencia mediada por `lumid`

**Files:**
- Modify: `crates/lumi-proto/src/worker.rs`
- Modify: `crates/lumid/src/queue/worker.rs`
- Modify: `crates/lumid/src/queue/mod.rs`
- Modify: `crates/lumid/src/routes/analyses.rs`
- Modify: `crates/lumid/src/bitacora.rs`
- Test: `crates/lumi-proto/src/worker.rs`

**Interfaces:**
- Consumes: `Herramienta.id` de Task 1 y el canal de eventos `queue::worker::Evento` actual.
- Produces: `Job.herramienta`, `Msg::ResultadosHerramienta`, `Evento::ResultadosHerramienta` y una sola función de cola que persiste resultados + bitácora.

- [ ] **Step 1: Escribir pruebas de deserialización y validación**

Añadir a los tests de `worker.rs`:

```rust
#[test]
fn resultado_de_herramienta_exige_origen_y_puntuacion_finita() {
    let m: Msg = serde_json::from_str(r#"{"tipo":"resultadosherramienta","id":7,"herramienta":"verify_image","resultados":[{"titulo":"C2PA","puntuacion":0.8,"origen":{"modelo":"c2pa-rs"}}]}"#).unwrap();
    assert!(m.validar().is_ok());
    assert!(serde_json::from_str::<Msg>(r#"{"tipo":"resultadosherramienta","id":7,"herramienta":"verify_image","resultados":[{"titulo":"x","puntuacion":"NaN","origen":{}}]}"#).is_err());
}
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `cargo test -p lumi-proto resultado_de_herramienta_exige_origen_y_puntuacion_finita -- --nocapture`

Expected: FAIL porque la variante aún no existe.

- [ ] **Step 3: Ampliar el protocolo sin romper geolocalización**

Conservar `Job::nuevo` y los mensajes existentes. Añadir campos con `#[serde(default)]`:

```rust
pub struct Job { /* campos existentes */ #[serde(default)] pub herramienta: String, #[serde(default)] pub opciones: serde_json::Value }
pub struct ResultadoHerramienta { pub titulo: String, pub puntuacion: f64, pub datos: serde_json::Value, pub origen: serde_json::Value }
```

`Msg::ResultadosHerramienta { id, herramienta, resultados }` valida puntuaciones finitas, objeto `origen` no vacío y que `datos` sea JSON. En `queue/worker.rs`, convertirlo en un `Evento` nuevo; cualquier mensaje de herramienta que llegue a un worker de geolocalización se trata como fallo explícito.

- [ ] **Step 4: Persistir solo en el daemon**

En `queue/mod.rs`, el manejador de `Evento::ResultadosHerramienta` llama a un helper de `routes/analyses.rs` que, en una transacción, comprueba que `analysis.source_id` corresponde a la herramienta, inserta filas en `resultados`, escribe `herramienta.terminada` mediante `bitacora::anotar` y emite `Cambio::ResultadosListos`. El worker no recibe credenciales SQLite ni ruta de la base.

- [ ] **Step 5: Añadir una prueba de integración de transacción**

Crear un análisis/fuente temporal, persistir dos resultados y comprobar que hay dos filas y una entrada de bitácora. Repetir con herramienta distinta: esperar error y cero filas nuevas.

- [ ] **Step 6: Verificar y confirmar compatibilidad**

Run: `cargo test -p lumi-proto && cargo test -p lumid resultados_herramienta && cargo build -p lumid`

Expected: PASS. Ejecutar además el flujo de geolocalización existente: debe seguir produciendo `Msg::Vectores`/`Msg::Resultado` sin necesidad de `herramienta`.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-proto/src/worker.rs crates/lumid/src/queue/{worker.rs,mod.rs} crates/lumid/src/routes/analyses.rs crates/lumid/src/bitacora.rs
git commit -m "feat(darkroom): contrato común de resultados para workers"
```

---

### Task 3: Reservas de modelos y gestor LRU de VRAM

**Files:**
- Create: `crates/lumid/src/gestor_modelos.rs`
- Modify: `crates/lumid/src/queue/mod.rs`
- Modify: `crates/lumid/src/routes/models.rs`
- Modify: `registros/niveles/mini.json`
- Modify: `registros/niveles/pro.json`
- Modify: `registros/niveles/vision.json`
- Test: `crates/lumid/src/gestor_modelos.rs`

**Interfaces:**
- Consumes: modelos/roles cargados por `Queue` y `EstadoCapacidad::SinVram` de Task 1.
- Produces: `GestorModelos::reservar`, `PrestamoModelo` (RAII) y `GestorModelos::estado`.

- [ ] **Step 1: Escribir los casos LRU críticos**

```rust
#[test]
fn libera_el_menos_reciente_pero_no_un_modelo_prestado() {
    let g = GestorModelos::nuevo(12);
    let a = g.reservar("a", 6).unwrap(); drop(a);
    let b = g.reservar("b", 6).unwrap();
    assert!(g.reservar("c", 7).is_err()); // b sigue prestado
    drop(b);
    let c = g.reservar("c", 7).unwrap();
    assert_eq!(c.id(), "c");
}
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `cargo test -p lumid gestor_modelos::tests -- --nocapture`

Expected: FAIL porque no existe el módulo.

- [ ] **Step 3: Implementar reserva explícita, no descarga implícita**

`GestorModelos` mantiene por GPU `id`, GB reservados, número de préstamos y `ultimo_uso`. `reservar` reutiliza un modelo residente o expulsa solo residentes con préstamos `0`, del más antiguo al más reciente. Si no cabe, devuelve `SinVram { necesita_gb, disponibles_gb }`; no mata procesos ni degrada de nivel. `PrestamoModelo::drop` reduce el préstamo y actualiza el uso.

- [ ] **Step 4: Conectar la cola y los niveles**

Antes de lanzar un worker, `queue` resuelve sus roles contra el JSON del nivel y toma préstamos. Mantenerlos hasta `Resultado`, `Fallo` o muerte del worker. Añadir a los registros el coste VRAM por papel de Darkroom, sin asignar modelos de licencias no verificadas. `routes/models::estado` expone uso/reserva para que la matriz pueda dar un motivo concreto.

- [ ] **Step 5: Verificar**

Run: `cargo test -p lumid gestor_modelos::tests && cargo build -p lumid`

Expected: PASS. Prueba manual con presupuesto de 12 GB: cargar A=6, prestar B=6, pedir C=7 devuelve `sin_vram`; al soltar B, C entra expulsando el residente LRU permitido.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/gestor_modelos.rs crates/lumid/src/queue/mod.rs crates/lumid/src/routes/models.rs registros/niveles/{mini.json,pro.json,vision.json}
git commit -m "feat(darkroom): gestor LRU de VRAM para herramientas"
```

---

### Task 4: Adaptadores externos, confirmación y auditoría de red

**Files:**
- Create: `crates/lumid/src/externos.rs`
- Create: `crates/lumid/src/routes/externos.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs`
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumid/src/bitacora.rs`
- Modify: `crates/lumi-proto/src/api.rs`
- Create: `client/src/admin/ServiciosExternosView.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`
- Test: `crates/lumid/src/externos.rs`

**Interfaces:**
- Consumes: configuración `meta`, autorización admin y `bitacora::anotar` del spec 2.
- Produces: trait `AdaptadorExterno`, `externos::enviar`, `GET/PUT /v1/admin/externos/:id` y `POST /v1/admin/externos/:id/probar`.

- [ ] **Step 1: Escribir el test de no-filtración y doble auditoría**

Probar con un adaptador falso que captura el payload: tras `enviar`, deben existir `externo.enviado` y `externo.respondido`; serializar la bitácora y afirmar que no contiene `api_key` ni el cuerpo de respuesta completo.

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `cargo test -p lumid externos::tests -- --nocapture`

Expected: FAIL porque el módulo aún no existe.

- [ ] **Step 3: Implementar el trait y la política**

```rust
pub trait AdaptadorExterno: Send + Sync {
    fn id(&self) -> &'static str;
    fn activo(&self) -> bool;
    fn describe_envio(&self, req: &SolicitudExterna) -> String;
    async fn ejecutar(&self, req: SolicitudExterna) -> Result<RespuestaExterna, ErrorExterno>;
}
```

`enviar` exige configuración habilitada y credencial, bloquea módulos activos sin el booleano de confirmación de esa ejecución y aplica límite por adaptador. Inserta `externo.enviado` antes de HTTP y `externo.respondido` o `externo.fallo` después. Guardar solo hash de imagen, lista de campos y resumen/código/duración.

- [ ] **Step 4: Añadir administración y esquema de almacenamiento**

En `store.rs`, crear `external_services` con `id`, `habilitado`, `activo_permitido`, `limite_por_minuto`, `secret_ref`, `actualizado_en`; el secreto va al almacén seguro que ya usa `api_keys`, no a JSON ni a logs. La ruta admin valida que el id existe en el registro de adaptadores. «Probar» usa una solicitud de salud sin datos de caso y también queda auditada.

- [ ] **Step 5: Crear la interfaz de administración**

`ServiciosExternosView` lista proveedor, estado, datos que recibe, límite y si es activo. Guardar no ejecuta prueba. Un módulo activo exige una segunda frase de confirmación en el formulario; el lanzamiento desde una fuente vuelve a pedir un clic informado.

- [ ] **Step 6: Verificar**

Run: `cargo test -p lumid externos::tests && cargo build -p lumid -p lumi-proto && cd client && npx tsc -b --noEmit && npm run lint`

Expected: PASS. Confirmar manualmente que un adaptador apagado devuelve 403 con motivo y que la cadena de actividad sigue íntegra tras una prueba.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/{externos.rs,store.rs,bitacora.rs} crates/lumid/src/routes/{mod.rs,externos.rs} crates/lumid/src/main.rs crates/lumi-proto/src/api.rs client/src/admin/{ServiciosExternosView.tsx,AdminPanel.tsx}
git commit -m "feat(darkroom): servicios externos explícitos y auditables"
```

---

### Task 5: Auditor IA calibrado y salida estructurada

**Files:**
- Create: `crates/lumid/src/auditor.rs`
- Create: `crates/lumid/src/routes/auditoria.rs`
- Modify: `crates/lumid/src/routes/calibracion.rs`
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `client/src/admin/CalibracionView.tsx`
- Modify: `client/src/work/darkroom/CajonFuente.tsx`
- Test: `crates/lumid/src/auditor.rs`

**Interfaces:**
- Consumes: servicio local/compatible OpenAI de Task 4 y `ResultadoHerramienta` de Task 2.
- Produces: `auditor::evaluar`, `VeredictoAuditor`, `CalibracionAuditor` y estado `sin_calibrar` para capacidades.

- [ ] **Step 1: Escribir las pruebas de enum y caducidad**

```rust
#[test]
fn la_calibracion_caduca_si_cambia_version_o_esquema() {
    let c = CalibracionAuditor::aprobada("qwen", "1", "v1");
    assert!(c.vigente_para("qwen", "1", "v1"));
    assert!(!c.vigente_para("qwen", "2", "v1"));
    assert!(!c.vigente_para("qwen", "1", "v2"));
}
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `cargo test -p lumid auditor::tests -- --nocapture`

Expected: FAIL porque no existen los tipos.

- [ ] **Step 3: Implementar una frontera estricta de auditoría**

Definir `VeredictoAuditor` como enum cerrado. `evaluar` envía contexto mínimo y exige JSON que encaje en:

```rust
struct SalidaAuditor { veredicto: VeredictoAuditor, motivo: String, evidencia: Vec<String> }
```

Rechazar JSON inválido, motivo vacío o evidencia ausente como `abstencion` registrada, no como un veredicto inventado. Guardar modelo, versión, esquema y evidencia en `resultados.auditoria_json`; nunca escribir `revision`.

- [ ] **Step 4: Persistir calibración por herramienta**

Crear tabla `auditor_calibraciones` con herramienta, modelo, versión, esquema, conjunto, métricas JSON, aprobado_por, aprobado_en y `habilitada`. Añadir endpoints de lista/creación/deshabilitación a la ruta nueva, usando el permiso admin. Reutilizar la ruta de calibración actual solo para su sección de verificadores; no mezclar umbrales geométricos con calidad de IA.

- [ ] **Step 5: Mostrar sin permitir que decida**

En `CajonFuente`, mostrar veredicto y motivo como señal secundaria. El control segmentado de revisión permanece humano e independiente. En `CalibracionView`, un auditor sin calibración vigente muestra «Sin calibrar» y no ofrece activarlo.

- [ ] **Step 6: Verificar**

Run: `cargo test -p lumid auditor::tests && cargo build -p lumid && cd client && npx tsc -b --noEmit && npm run lint`

Expected: PASS. Confirmar manualmente que cambiar la versión del modelo vuelve su capacidad a `deshabilitado` y una salida de IA inválida se guarda como abstención.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/{auditor.rs,store.rs} crates/lumid/src/routes/{auditoria.rs,calibracion.rs} crates/lumi-proto/src/api.rs client/src/admin/CalibracionView.tsx client/src/work/darkroom/CajonFuente.tsx
git commit -m "feat(darkroom): auditor IA estructurado y calibrado"
```

---

### Task 6: Pistas de región confirmables y reponderación trazable

**Files:**
- Create: `crates/lumid/src/pistas.rs`
- Create: `crates/lumid/src/routes/pistas.rs`
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs`
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `client/src/work/MapCanvas.tsx`
- Modify: `client/src/work/mapEngine.ts`
- Modify: `client/src/work/darkroom/CajonFuente.tsx`
- Test: `crates/lumid/src/pistas.rs`

**Interfaces:**
- Consumes: resultados de Task 2, revisión del spec 2 y bitácora encadenada.
- Produces: `PistaRegion`, `POST/PATCH /v1/pistas/:id`, `pistas::confirmar` y evento SSE de cambio de fuente.

- [ ] **Step 1: Escribir la prueba de la frontera humana**

```rust
#[test]
fn una_pista_no_repondera_hasta_confirmacion() {
    let id = insertar_pista_temporal("resultado", 9);
    assert_eq!(factores_aplicados(id), 0);
    confirmar(id, 3).unwrap();
    assert_eq!(factores_aplicados(id), 1);
}
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `cargo test -p lumid pistas::tests -- --nocapture`

Expected: FAIL porque falta el módulo.

- [ ] **Step 3: Crear datos y transición de estado**

Crear `pistas_region` (`resultado_id`, geometría JSON, confianza, motivo, evidencia, origen, estado, creado_en, confirmado_por, confirmado_en`) y `reponderaciones_pista` (`pista_id`, `analysis_id`, `factor`, `antes`, `despues`). `confirmar` valida que la pista está sin revisar, actualiza el estado, calcula y guarda cada cambio de hipótesis dentro de una transacción y anota `pista.confirmada`. `descartar` no toca hipótesis y anota `pista.descartada`.

- [ ] **Step 4: Exponer API y representación**

La ruta exige `guard_case`; solo una persona con el candado del caso puede confirmar o descartar. `MapCanvas` dibuja el contorno warning discontinuo mientras no se revise y relleno/contorno continuo al confirmar, como define el spec 2. El cajón expone motivo, evidencia y botones Confirmar/Descartar; no muestra una pista como una coordenada precisa.

- [ ] **Step 5: Verificar**

Run: `cargo test -p lumid pistas::tests && cargo build -p lumid -p lumi-proto && cd client && npx tsc -b --noEmit && npm run lint`

Expected: PASS. Prueba manual: confirmar una pista explica el factor y la hipótesis afectada en Actividad; descartar otra no cambia ninguna puntuación.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/{pistas.rs,store.rs} crates/lumid/src/routes/{mod.rs,pistas.rs} crates/lumid/src/main.rs crates/lumi-proto/src/api.rs client/src/work/{MapCanvas.tsx,mapEngine.ts} client/src/work/darkroom/CajonFuente.tsx
git commit -m "feat(darkroom): pistas de región confirmables y trazables"
```

---

### Task 7: Cierre transversal y documentación operativa

**Files:**
- Modify: `FUTURO.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-09-22-darkroom2-00-indice-design.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: todas las tareas anteriores.
- Produces: instrucciones precisas para administrador y el estado real del índice Darkroom2.

- [ ] **Step 1: Documentar configuración y límites**

En `ARCHITECTURE.md`, describir el límite de confianza: la cadena de bitácora acredita cambios locales pero no sustituye una copia exportada; el auditor es sugerencia calibrada; los servicios externos solo reciben lo anunciado. En `README.md`, añadir cómo instalar modelos con licencia aceptada, habilitar un adaptador y revisar una calibración, sin incluir secretos ni pasos de scraping.

- [ ] **Step 2: Actualizar el índice sin adelantar herramientas futuras**

Marcar el spec 3 como implementado solo después de que las tareas anteriores estén cerradas. En `FUTURO.md`, mantener explícitamente aplazados GHunt, SpiderFoot, scraping general, atribución entrenada y matrícula → titular.

- [ ] **Step 3: Ejecutar la verificación completa**

Run:

```bash
cargo test -p lumi-proto
cargo test -p lumid
cargo build --workspace
cd client && npx tsc -b --noEmit && npm run lint
```

Expected: todos los comandos terminan con exit code 0. Recorrer manualmente: capacidad bloqueada → instalación/licencia → reserva de VRAM → worker → resultado → auditor → pista confirmada → bitácora íntegra; después verificar un servicio externo deshabilitado y una calibración caducada.

- [ ] **Step 4: Commit**

```bash
git add FUTURO.md ARCHITECTURE.md README.md docs/superpowers/specs/2026-09-22-darkroom2-00-indice-design.md
git commit -m "docs(darkroom): operación de la infraestructura de herramientas"
```

---

## Cobertura del spec

- Registro, compatibilidad y motivos de capacidad: Task 1.
- Contrato JSON-lines y persistencia solo en daemon: Task 2.
- Manifiestos, niveles, VRAM bajo demanda y LRU: Task 3.
- Servicios explícitos, activos confirmados y auditoría de red: Task 4.
- VLM/LLM estructurado, auditor no decisor y calibración: Task 5.
- Pistas de región, confirmación y reponderación explicable: Task 6.
- Límites, documentación y recorrido end-to-end: Task 7.

La plan no implementa herramientas finales ni descarga modelos inciertos; ambos quedan expresamente para sus specs posteriores.
