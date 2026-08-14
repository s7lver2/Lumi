# Subsistema 3a — Gestión de modelos

**Fecha:** 2026-08-13
**Estado:** diseño e interfaz aprobados. El esqueleto del panel (`2026-08-13-esqueleto-panel-design.md`)
ya está implementado en `s3-esqueleto`; esta spec pasa a plan de implementación.
**Mockups:** `docs/superpowers/specs/lumi-s3a-mockups.html` (secciones 1 a 8)

## 1. Qué resuelve

El 5b y el 5c dejaron el motor de inferencia implementado y **sin poder cargar un solo peso**.
Instalar un modelo hoy es: leer el registro JSON a mano, encontrar de dónde sale el peso —el campo
`pesos_url` apunta a la página del proyecto, no a un fichero—, descargarlo por tu cuenta,
calcular su `sha256` y escribirlo en el registro, colocar una `LICENCIA.txt` al lado porque
`lumi_pesos._licencia` se niega a cargar sin ella, y reiniciar el daemon para que relea el registro.
Veintiún ficheros así.

Este ciclo convierte eso en una pantalla: elegir qué nivel quieres poder correr, leer y aceptar las
licencias de lo que implica, y esperar a que se descargue y se verifique.

## 2. Alcance

**Dentro:**

- Campos nuevos en los cuatro registros: URL del fichero, licencia, y la marca de «puerta».
- La pantalla de aceptación de licencias, y lo que queda escrito al aceptar.
- La descarga como **tarea del servidor**, con verificación, colocación de licencia y log.
- El caso del proveedor que exige token propio: token o guía manual.
- Recarga en caliente de los cuatro registros y de los datos geográficos al terminar una descarga.
- La misma pantalla en dos sitios: un paso nuevo del asistente y una entrada del panel.
- Un peso que falta se ve **apagado**, no solo distinto — el mismo lenguaje que ya usa una capacidad
  deshabilitada en el resto del producto.
- Una **rejilla de licencias que se eligen para leerse**, en vez de tres textos cortados a la vez.
- Toasts de progreso y de licencia pendiente que **no dependen de estar en la sección Modelos**: se
  ven en cualquier sección del panel, y un clic te lleva a la que corresponde.

**Fuera, y por qué:**

- **Rediseñar solicitudes, usuarios, mapa e índices.** Es el resto del 3. Aquí solo se ocupa la
  entrada que el esqueleto del panel ya les habrá dado.
- **Hardware, monitorización, mantenimiento y notificaciones.** Son el 3c.
- **Entrenar, convertir o cuantizar.** Lumi instala pesos que otros publicaron, comprueba que son
  los que dicen ser, y deja escrito bajo qué licencia entraron. Nada más.
- **Gestionar versiones de un mismo modelo.** Un modelo tiene la versión que dice su registro. Que
  convivan dos versiones de MegaLoc es un problema de Qdrant y de las capas de índice, no de esta
  pantalla.

## 3. El registro crece cuatro campos

Los cuatro registros (`registros/modelos/`, `registros/verificadores/`, `registros/agentes/` para
sus motores, y `registros/geo/`) ganan:

| Campo | Significa |
|---|---|
| `fichero_url` | La URL **directa del peso**. Vacío significa «este no se puede bajar solo» y la pantalla pasa a modo guía. Hoy `pesos_url` apunta a la página del proyecto y se conserva: son dos cosas distintas y las dos se enseñan. |
| `licencia_url` | De dónde sale el texto que se te enseña antes de aceptar. |
| `licencia_texto` | El texto cacheado, para que la pantalla de aceptación funcione sin red. Vacío significa «hay que ir a buscarlo», y entonces se pide con la primera petición de la instalación —antes de tocar ningún peso. |
| `puerta` | `null`, o `"token"` cuando el proveedor exige credencial propia. Hoy solo RoMa v2, por DINOv3. |

`sha256` deja de publicarse vacío: el proyecto descarga cada peso una vez y anota el real, como se
hizo con el binario de Qdrant en el subsistema 1.

## 4. Dos afirmaciones distintas sobre el mismo fichero, y no se mezclan

- **Verificado contra un hash conocido** — el registro traía `sha256` y lo descargado coincide.
  Es la única afirmación fuerte que la pantalla hace.
- **Verificado solo contra sí mismo** — el registro no traía hash, así que se guardó el de lo que
  bajó. Detecta corrupción y cambios posteriores; **no** dice que el fichero sea el correcto.

Se muestran con esas dos frases y con dos colores distintos (blanco y ámbar). Confundirlas sería
prometer una garantía que no existe, y esto es una herramienta forense.

**Si un hash conocido no cuadra, el fichero se borra.** No se guarda «por si acaso» y no hay un
«usar de todas formas»: misma postura que el aprovisionamiento de Qdrant del 1 y que la huella del
certificado en la vinculación.

## 5. Las licencias se aceptan antes de tocar la red

Antes de la primera petición se muestran **todas** las licencias de lo que se va a instalar,
agrupadas por texto —MIT aparece una vez aunque la usen dos modelos— y diciendo de quién es cada
una. Un solo gesto de aceptación cubre el lote. Hasta que no se dé, no sale ni una petición.

Al aceptar:

1. Se registra **qué se aceptó, cuándo y con qué cuenta**, en una tabla nueva.
2. Se escribe cada texto como `LICENCIA.txt` junto a sus pesos — con lo que la comprobación que
   `lumi_pesos._licencia` ya hace deja de ser trabajo manual y pasa a cumplirse sola.

El que acepta es el dueño del servidor, no el programa. Esa es la razón de que la pantalla exista
en vez de aceptar en silencio al descargar.

## 6. Cuando el proveedor pone su propia puerta

RoMa v2 se apoya en DINOv3, cuya licencia hay que aceptar **en el sitio de quien la publica** y que
exige un token para descargar. Aceptar dentro de Lumi no abre esa puerta, y fingir que sí sería
mentir. Con `puerta: "token"`, la pantalla ofrece dos caminos y ninguno automático:

- **Pegar un token propio**, que se guarda como el resto de secretos del servidor y se redacta en
  los logs, igual que ya se hace con la clave de Flickr.
- **Descargar el fichero tú** y dejarlo en su sitio con su `LICENCIA.txt`; Lumi lo detecta y lo
  verifica igual.

Y si decides no instalarlo, no pasa nada: la degradación por nivel del 5b ya cubre eso, y el
análisis dice con qué corrió.

## 7. La descarga es una tarea del servidor

El paso «Instalar runtime» del asistente ya lanza una tarea en el servidor con log por SSE,
reenganchable si cierras la app. Bajar pesos es esa misma forma de trabajo, así que **se reutiliza
el runner tal cual**: un `TaskKind` nuevo que ejecuta `workers/lumi_bajar.py`, un script de solo
biblioteca estándar que descarga, calcula el `sha256` mientras baja y escribe la `LICENCIA.txt`.

Se eligió esto sobre descargar nativamente en Rust —que daría progreso estructurado pero obliga a
enseñarle al runner un tipo de tarea que no es «un comando de shell», que hoy es toda su forma— y
sobre descargar desde el cliente Tauri, que dejaría los pesos en el portátil del administrador en
vez de en el servidor.

Cancelar detiene lo que queda; lo ya descargado y verificado se conserva.

`lumi_bajar.py` emite, junto a las líneas normales del log, una línea de progreso con un prefijo
reconocible propio (p. ej. `@progreso {"nivel":"vision","item":"cliquemining","mib":712,"total_mib":1148,"pct":62}`)
cada vez que avanza. Es el mismo log que ya llega por SSE — no hay un segundo canal — y es lo que la
§8 lee para pintar la barra del toast sin tener que estructurar el protocolo de tareas para un solo caso.

## 8. El progreso no vive en la sección Modelos

Que la descarga sea una tarea del servidor (§7) resuelve la mitad del problema: sigue corriendo si
cierras la pestaña. La otra mitad es que **te enteres** sin tener que volver a Modelos por
curiosidad, y que puedas actuar sin dos clics de más. Dos toasts cubren eso, montados **al nivel del
panel** (`AdminPanel`, no dentro de la vista de Modelos), así que se ven en cualquiera de sus
secciones — Resumen, Usuarios, Cola, lo que sea. Salir del panel a un caso los quita de la vista,
pero no toca la tarea: sigue corriendo en el servidor igual, y al volver al panel el progreso sigue
ahí, no se perdió nada.

**Descubrimiento, no memoria del cliente.** Una pestaña que se acaba de abrir tiene que enterarse de
una descarga que empezó otra sesión, así que no puede depender de que el navegador la recuerde. El
daemon guarda el id de la tarea de modelos activa (una a la vez, como ya lo es hoy con «instalar
todo lo que falta») en sus metadatos, igual que ya guarda `models_dir`; un endpoint nuevo,
`GET /v1/admin/model-task`, contesta `{ id, nivel, item }` o `null`. `AdminPanel` lo sondea cada
pocos segundos mientras está montado —sin importar la sección— y, si hay tarea, se reengancha a su
log por SSE exactamente como ya hace `ProvisionStep`, leyendo la última línea `@progreso` para la
barra del toast.

- **Toast de progreso** — aparece mientras `GET /v1/admin/model-task` devuelva algo. Un clic pone
  `seccion = "modelos"` con ese nivel ya desplegado.
- **Toast de licencias pendientes** — aparece cuando el gesto «instalar»/«completar nivel» ya se
  disparó y la pantalla de aceptación de licencias (§5) sigue sin resolverse. Es estado de
  **este panel montado**, no del servidor: no hay ninguna tarea todavía —la §5 es explícita en que no
  sale ni una petición hasta aceptar— así que no sobrevive a un cierre de la app, solo a cambiar de
  sección dentro de la misma sesión de panel. Un clic pone `seccion = "modelos"` con la pantalla de
  licencias abierta donde se dejó.

Ninguno de los dos se autocierra mientras siga vigente: un toast de progreso que desaparece solo deja
de decir nada nuevo, y uno de licencia pendiente que se esconde solo es la pantalla de aceptación
escondiéndose de quien la necesita.

## 9. Agrupado por nivel, porque los niveles no anidan

Un dueño de servidor no piensa en «ocho recuperadores y cinco verificadores», piensa en qué niveles
puede ofrecer. La lista se agrupa en Mini, Pro y Vision, cada uno plegado con su medidor.

Y hay una razón dura además de la ergonómica: **los niveles no se contienen**. Mini corre con
CosPlace y tiny-RoMa; Pro no usa ninguno de los dos, sino otros cuatro recuperadores y otros dos
verificadores; Vision reutiliza los cuatro de Pro, añade tres más y recupera CosPlace, pero no
tiny-RoMa. **Instalar Pro no deja Mini instalado**, y agruparlo por nivel es lo que hace que eso se
vea antes de descargar seis gigas.

Un peso que ya está en disco porque otro nivel lo usa se marca **compartido** y no suma en el total:
un peso es un fichero, aunque tres niveles lo nombren.

Un peso que falta se enseña **apagado**: punto hueco en vez de relleno, texto atenuado. Es el mismo
lenguaje que ya usa una capacidad deshabilitada en el resto del producto — «esto no está» se lee de
un vistazo, sin tener que parar a leer el chip de al lado.

## 10. Recarga en caliente

Hoy los cuatro registros y los datos geográficos se cargan **una vez al arrancar** el daemon
(`queue::Cola::nuevo`). Al terminar una descarga se releen sin reiniciar. Es la diferencia entre
«instalar un modelo» y «instalar un modelo y reiniciar el servidor a mano por SSH» — y el dueño
que usa esta pantalla es precisamente el que puede no tener shell en esa máquina.

La recarga sustituye el registro en memoria entero, no lo parchea: un análisis en curso sigue con
el que tenía cuando empezó.

## 11. Dónde vive

| Sitio | Qué se ve |
|---|---|
| **Asistente, paso nuevo** | Después de «Instalar runtime», que es cuando el venv de torch ya existe. Con un mínimo: **completar Mini basta para avanzar**. Lo demás no bloquea el primer arranque. |
| **Panel de administración** | La misma pantalla entera, en su entrada de la barra lateral. Es donde se añade Vision seis meses después, o se revisa integridad tras un susto de disco. |

El asistente no tiene sidebar ni otras secciones que visitar mientras se instala Mini, así que los
toasts de la §8 son cosa del panel: en el asistente, el progreso se ve en la propia pantalla porque
no hay ningún otro sitio al que irse.

## 12. Datos

Una tabla para lo aceptado, que es a la vez el registro de auditoría de la §5:

```sql
CREATE TABLE model_licenses (
    licencia    TEXT NOT NULL,   -- 'MIT', 'Apache-2.0', 'CC BY 4.0'…
    para        TEXT NOT NULL,   -- ids separados por coma de lo que cubrió
    aceptada_por TEXT NOT NULL,  -- cuenta que la aceptó
    aceptada_en INTEGER NOT NULL,
    PRIMARY KEY (licencia, para)
);
```

Los tokens de proveedor van donde ya viven los secretos del servidor, cifrados y redactados en logs.

El id de la tarea de modelos activa (§8) va en los mismos metadatos donde ya vive `models_dir` —
`model_task_id`, una clave más, no una tabla nueva. Se pone al lanzar la tarea y se quita al
terminar, running o no: no necesita sobrevivir un reinicio, porque un reinicio ya corta la tarea que
describía.

## 13. Interfaz

En `lumi-s3a-mockups.html`, secciones 1 a 8. Aprobada.

## 14. Pruebas

Solo lo no mecánico y solo donde haya lógica pura: la resolución de qué falta para cada nivel
teniendo en cuenta los pesos compartidos, y el cálculo del tamaño total sin contar dos veces un
fichero que dos niveles nombran. El resto se verifica ejecutando.

## 15. Alternativas descartadas

- **Solo acompañar y verificar, sin descargar nunca.** Más simple y sin URLs que se pudran en el
  registro; a cambio, instalar veintiún pesos siguen siendo veintiuna descargas manuales.
- **Descargarlo todo resolviendo cada caso raro**, incluida la aceptación de licencias ajenas. Mete
  al producto en el negocio de automatizar la aceptación de términos de terceros, que es justo la
  frontera que el 5b decidió no cruzar.
- **Confiar en la primera descarga y fijar ese hash.** Cero mantenimiento, pero si la primera
  descarga viniera manipulada el sistema la bendice y no se vuelve a cuestionar. Se conserva solo
  como el caso degradado, y **dicho con esas palabras**.
- **Agrupar por tipo de registro** (recuperadores, verificadores, agentes, geo) en vez de por nivel.
  Es la estructura real de los ficheros, y es exactamente la que oculta que Pro no contiene a Mini.
- **Lista de tareas en el runner** (`GET /v1/tasks`) en vez de un id en los metadatos del daemon.
  Serviría para más que este caso, pero hoy el runner solo tiene dos tipos de tarea y ninguna otra
  necesita descubrirse así — añadir una lista general para un solo consumidor es la abstracción antes
  de que haga falta.

## 16. Consecuencias en los documentos

- `ARCHITECTURE.md §5`: el 3 deja de ser una sola fila; 3a pasa a terminado cuando se implemente.
- `CLAUDE.md`: `registros/` deja de describirse como «se edita a mano».
- `FUTURO.md`: sale la promesa de «rotar la clave del proveedor de mapas» del 3b, que este ciclo no
  toca, y entra la gestión de versiones de un mismo modelo.
