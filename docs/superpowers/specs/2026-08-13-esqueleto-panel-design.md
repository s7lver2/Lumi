# Subsistema 3 · esqueleto del panel de administración

**Fecha:** 2026-08-13
**Estado:** aprobado, pendiente de plan
**Mockup:** `docs/superpowers/specs/lumi-s3-panel-mockup.html` (interactivo)
**Siguiente ciclo:** `2026-08-13-modelos-3a-design.md`, que ya está escrito y aparcado esperando
a que esta pantalla exista.

## 1. Qué resuelve

`AdminPanel.tsx` es hoy una página de 3xl de ancho con un botón que alterna entre «Solicitudes» y
«Usuarios», y debajo, apiladas, una fila de cola, una fila de mapa y un panel de índices. Cada una
llegó con un subsistema distinto y todas llevan un comentario que dice *PROVISIONAL, el subsistema
3 rehace el panel entero*. No hay navegación: hay una pila que crece por abajo.

Este ciclo construye el armazón —barra lateral, secciones, pantalla de inicio— y muda lo que ya
existe a su sitio **sin tocarle las tripas**. Es el chasis donde el 3a enchufa la gestión de
modelos y el 3c la operación de la máquina.

## 2. Alcance

**Dentro:**

- Layout de dos columnas con barra lateral, y estado de sección dentro del panel.
- Las entradas de lo que no existe todavía, **atenuadas y con su motivo**, no ocultas.
- Una pantalla de **Resumen** nueva, con un endpoint que la sirve de una sola petición.
- Mudanza de `RequestsView`, `UsersView`, `QueueRow`, `MapRow` e `IndicesPanel` a su sección.
- **Solicitudes desplegables**: al pulsar una se abre con el mensaje que escribió el solicitante,
  desde dónde y desde qué dispositivo.
- **Tres vistas de usuarios**: lista, retícula solo con avatar, retícula con avatar y nombre.
- Una sección **API Keys** que reúne las credenciales de terceros del servidor.
- Un botón **Instalar índice** que todavía no hace nada, y lo dice.

**Fuera, y por qué:**

- **Rediseñar por dentro las cinco vistas mudadas.** Es el 3b. Mover y rediseñar son dos trabajos
  distintos y mezclarlos en un plan es donde se cuelan los errores difíciles de revisar.
- **Mantenimiento, notificaciones y hardware.** Son el 3c y aquí solo aparecen como entradas
  declaradas.
- **Gestión de modelos.** Es el 3a, ya diseñado.
- **Lo que abre «Instalar índice».** El catálogo remoto del 8 dentro del panel es trabajo propio.

## 3. El armazón

`AdminPanel.tsx` pasa de página apilada a **layout de dos columnas**: barra lateral de 206 px y
área de contenido con su propio desplazamiento. Qué sección está abierta vive en el propio panel;
`App.tsx` sigue teniendo un solo `mode === "admin"` y no se toca el enrutado de la aplicación.

Se entra desde la barra de título, que ya tiene el botón. El caso que dejaste **se queda detrás
desenfocado** y el panel se posa encima: administrar es una tarea más, no otra aplicación, y por
eso salir tiene que sentirse como volver. El botón lleva un punto ámbar cuando hay algo esperando.

## 4. La barra lateral

Tres grupos, y dentro de cada uno las entradas en el orden en que se necesitan:

| Grupo | Entradas |
|---|---|
| **Servidor** | Resumen · Modelos *(3a)* · Índices · API Keys |
| **Personas** | Solicitudes · Usuarios |
| **Operación** | Cola · Mantenimiento *(3c)* · Notificaciones *(3c)* · Hardware *(3c)* |

Las que aún no existen **se ven, atenuadas, con la palabra «pronto»**, y al abrirlas explican en una
frase qué serán y en qué ciclo. Es la regla de la matriz de capacidades aplicada a la navegación:
nada se esconde, todo lleva su causa. Aparecer de la nada dentro de tres meses es peor experiencia
que estar desde el principio diciendo que no están.

Los contadores van a la derecha, en ámbar cuando algo espera por ti. El indicador de sección activa
es **uno solo que se desliza** entre entradas — un elemento compartido hace que cambiar de sección
se lea como movimiento y no como dos cosas apagándose y encendiéndose.

Al pie, huella, puerto y versión. Son mono y no se pueden copiar de ningún otro sitio del panel.

## 5. Resumen

Cuatro fichas con lo que un dueño de servidor mira en cinco segundos: **qué espera por él**,
cuántas cuentas hay, cuánto se usa y qué hay instalado. Cada una con una chispa de contexto.

Las gráficas de la máquina **no viven aquí**: la franja de telemetría del subsistema 6 ya las tiene
arriba y siempre visibles, y duplicarlas sería inventar una segunda verdad sobre el mismo dato.

Dos fichas más, **en punteado y sin valor**: niveles listos y pesos en disco. Dependen del gestor
de modelos y no se pueden construir en este ciclo. Se declaran en vez de omitirse, por la misma
razón que las entradas atenuadas de la barra lateral.

### El endpoint

`GET /v1/admin/resumen` devuelve los números de una vez, en lugar de que el cliente dispare cuatro
peticiones y pinte la pantalla a trozos:

```rust
pub struct Resumen {
    pub solicitudes_pendientes: i64,
    /// Epoch de la más antigua sin resolver. `None` si no hay ninguna.
    pub solicitud_mas_antigua: Option<i64>,
    pub usuarios: i64,
    /// Conectados con el mismo criterio que ya usa la cola: estar suscrito a
    /// `/v1/queue/events` cuenta como estar conectado. Una segunda definición
    /// de «conectado» sería una segunda verdad sobre el mismo hecho.
    pub usuarios_conectados: i64,
    pub analisis_hoy: i64,
    pub analisis_en_cola: i64,
    /// Siete días, el más reciente al final. Alimenta la chispa.
    pub analisis_serie: Vec<i64>,
    pub indices: i64,
    pub indices_bytes: i64,
    pub teselas: i64,
    pub arrancado_en: i64,
}
```

## 6. Solicitudes desplegables

Aprobar a alguien es darle entrada a material de casos, y hasta ahora la decisión se tomaba con un
nombre y una fecha. Al pulsar una solicitud se abre con lo que ya se guarda y nunca se enseñó:

| Dato | De dónde sale |
|---|---|
| El mensaje que escribió | `access_requests.message`, que ya existe |
| Dirección de origen | `access_requests.source_ip`, que ya existe |
| Dentro o fuera de la red local | `AdminRequest.external`, que **ya lo calcula el servidor** para que la interfaz no tenga que saber de rangos de red |
| Cuándo la mandó | `access_requests.created_at` |
| **Dispositivo** | **No existe. Se añade.** |

`access_requests` gana una columna `device TEXT` que el cliente rellena al mandar la solicitud.
Es lo único de este ciclo que toca el camino del subsistema 2, y es una columna anulable: las
solicitudes que ya estén pendientes se enseñan con «no consta» en vez de con un dato inventado.

El despliegue anima altura automática con `grid-template-rows: 0fr → 1fr`, que no obliga a medir
la altura a mano ni a fijar un máximo que luego se queda corto con un mensaje largo.

## 7. Usuarios, tres densidades

Lista, retícula solo con avatar, y retícula con avatar y nombre. Un segmentado de tres iconos en la
cabecera, y **la elegida se recuerda** entre visitas.

El avatar es un monograma sobre superficie neutra. El punto de conexión va **fuera** de la caja del
avatar, no tiñéndola: un icono dentro de una caja de color es de las prohibiciones explícitas de
`DESIGN.md`.

Los límites por usuario se siguen leyendo por `limits::effective`, que es la única vía legítima.
Cambiar de vista no cambia nada de eso: es la misma lista con tres densidades.

## 8. API Keys

Todas las credenciales de terceros **del servidor**, en un sitio:

- **Proveedor de mapas.** Hoy se cambia por `PATCH /v1/admin/map`; aquí gana su fila con la clave
  truncada y un botón de rotar. Rotarla deja de exigir shell en la máquina.
- **Proveedor de pesos.** Todavía sin poner, declarada con «la pide el gestor de modelos»: es el
  token que el 3a necesitará para los modelos que su proveedor cierra tras una puerta.

Ninguna se muestra entera, ni después de guardarla: se ven los últimos caracteres, viajan cifradas
y salen redactadas de cualquier log, como ya hace `keys::redactar`.

Las claves de los **orígenes de red** —Mapillary, Flickr, Google, Mapbox Satellite— no están aquí
y no deben estarlo: viven en el Lumi Indexer, que es otra aplicación y no habla con este daemon.
Un servidor que no indexa no tiene por qué custodiar esas credenciales. La sección lo dice en una
línea, para que nadie las busque aquí.

## 9. Instalar índice

Un botón en la cabecera de Índices que **no hace nada todavía**. Abrirá el catálogo remoto del
subsistema 8 dentro del panel: buscar, ver el grafo de dependencias e instalar. Está puesto porque
el hueco declarado es mejor que el hueco escondido, y porque la cabecera de esa sección es su sitio
evidente el día que funcione.

## 10. Movimiento

- **Entrada escalonada.** Filas y fichas suben 9 px con expo-out y ~45 ms entre hermanas. Tope de
  nueve escalones: a partir de ahí la última tarda medio segundo en existir y eso ya es una espera.
- **Esqueleto de carga** con barrido, solo al entrar al panel. Cambiar de sección no vuelve a
  pedir. El esqueleto dice qué está pidiendo.
- **Indicador de la barra lateral**, uno solo, deslizándose 520 ms.
- **Números que cuentan** hasta su valor nuevo en vez de saltar: un número que salta se lee como un
  fallo de render, uno que sube se lee como un dato que cambió.
- **Barrido sobre la barra de progreso** de la cola: no representa progreso, representa que el
  proceso sigue vivo, que es lo que un log parado no dice.
- **`prefers-reduced-motion` lo apaga todo.** No es accesibilidad opcional: es una herramienta que
  se usa durante horas.

## 11. Copia

**En la pantalla no se justifica nada.** Los textos que explican por qué una decisión es la
correcta —el 409 de la cola, el criterio de `limits::effective`, la matriz de capacidades— viven en
esta spec, no en la interfaz. En el panel solo quedan dos líneas, y las dos son instrucción:

- «Ninguna se muestra entera, ni después de guardarla.»
- «Las de los orígenes de red —Mapillary, Flickr, Google— viven en el Lumi Indexer.»

Y una frase por hueco declarado, diciendo qué será.

## 12. Datos

Una columna nueva y nada más:

```sql
ALTER TABLE access_requests ADD COLUMN device TEXT;
```

La vista elegida de Usuarios se recuerda en el cliente, no en el servidor: es una preferencia de
quien mira, no un ajuste del servidor, y viajaría mal si dos administradores comparten cuenta.

## 13. Pruebas

Ninguna nueva. Este ciclo es mudanza, layout y una consulta de agregados; no hay lógica pura no
trivial que probar, y la convención del proyecto es no añadir pruebas a código mecánico. Se
verifica compilando, pasando `oxlint` y abriendo el panel.

## 14. Alternativas descartadas

- **Mudar y rediseñar de paso.** El panel nacería entero y coherente, y duplicaría largo el ciclo
  mezclando dos trabajos que se revisan con criterios distintos.
- **Solo el armazón, sin mudar nada.** El ciclo más pequeño posible, y deja la aplicación con dos
  navegaciones a la vez durante un ciclo entero, que es peor que cualquiera de las dos.
- **Ocultar las secciones que no existen.** Más limpio hoy, y convierte cada ciclo siguiente en una
  sorpresa. Declararlas cuesta una línea y evita que alguien busque durante diez minutos algo que
  no está.
- **Cuatro peticiones para el Resumen** en vez de un endpoint. Menos código de servidor, y la
  pantalla se pinta a trozos y con cuatro estados de error distintos.
- **Sección propia para el proveedor de mapas.** Es una fila; la sección de API Keys es su sitio,
  junto a las demás credenciales.

## 15. Consecuencias en los documentos

- `ARCHITECTURE.md §5`: el 3 se parte en 3-esqueleto (terminado), 3a, 3b y 3c.
- `CLAUDE.md`: el panel deja de describirse como esqueleto de dos vistas.
- `FUTURO.md`: sale lo de «rotar la clave del proveedor de mapas sin shell», que este ciclo
  resuelve; se queda el rediseño de solicitudes y usuarios, que pasa a ser el 3b.
