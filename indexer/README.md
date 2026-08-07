# Lumi Indexer

Una aplicación Tauri **independiente** de Lumi Station: no se vincula a ningún
servidor, no tiene cuentas ni sesiones. Es una herramienta de un solo operador
sobre su propia máquina. Lo que produce son paquetes `.lumidx` sellados —
territorio indexado, con su procedencia y su verificación.

Lo que **no** es: no es el motor de inferencia (ese es el subsistema 5), no es
el catálogo público de índices (ese es el 8), y no habla con `lumid` ni con el
cliente de Lumi Station. Comparte con ellos solo el vocabulario visual
(`client/src/ui`) y, en Rust, el crate `lumi-index`, que es lógica pura sin
GPU, sin servicios y sin ventana.

## Linux primero, y por qué

Redis **no publica binarios oficiales para Windows**. En Linux (y macOS) los
servicios corren nativos. En Windows, el Indexer se instala **dentro de
WSL** — es la misma postura que `ARCHITECTURE.md` §7 ya fija para el servidor
de Lumi Station, y no una decisión nueva de este subsistema.

Empaquetar un puerto de terceros (como Memurai) metería una dependencia con su
propia licencia dentro de un proyecto de código abierto; el Indexer prefiere
pedir WSL antes que eso.

### Los servicios en WSL con la ventana en Windows

Para desarrollar no hace falta meter la aplicación entera en WSL. El paso de
servicios trae un botón **«Levantar en WSL»** que hace tres cosas: instala lo
que falte dentro de la distribución, lo arranca ahí, y lo adopta desde el lado
Windows. El reenvío de `localhost` de WSL2 hace alcanzable un Redis atado a
`127.0.0.1` dentro de WSL sin exponerlo a la red, que es la parte que importa.

- **Redis** sale de los repositorios de la distribución (`apt-get`, como
  `root`, porque `sudo` sin terminal se queda esperando una contraseña que no
  llega).
- **Qdrant** no está en ningún repositorio: se baja su binario de las
  publicaciones oficiales del proyecto a `~/.lumi-indexer/bin`, sin tocar nada
  del sistema fuera del `$HOME`.

Es lo único de todo el módulo de servicios que descarga algo de internet, y por
eso solo ocurre al pulsar el botón: abrir la aplicación nunca instala nada.

### Adoptar, y no dejar huérfanos

El Indexer **adopta** cualquier servicio que ya esté escuchando en su puerto en
vez de lanzar un segundo contra él. La contrapartida es que un adoptado no es
suyo para matarlo, y esa diferencia se ve en **Ajustes → Servicios locales**:

- `propio` — proceso hijo del Indexer. Se para desde el panel y muere al cerrar
  la aplicación.
- `adoptado` — ya estaba. Sigue vivo al cerrar y hay que pararlo donde se lanzó.

Nada se lanza nunca con `--daemonize`: un demonio se desengancha y sobrevive a
la aplicación, que es exactamente el huérfano que esto evita. Al salir, el
Indexer apaga Redis por su propio protocolo y mata a los hijos que le queden.

Aun así, esto es un atajo para desarrollar en Windows, no la instalación
soportada: el trabajador de embebido sigue queriendo la GPU y el `venv` del
lado en que corre. Para indexar de verdad, el Indexer entero va dentro de WSL.

## Requisitos previos

En el `PATH`:

- `redis-server` (no en Windows nativo — ver arriba)
- `qdrant`
- `python3` (o `python`), para el venv del trabajador de embebido

Los dos servicios escuchan **solo en `127.0.0.1`**, con `protected-mode`
activo. Nunca en la red, bajo ninguna configuración: un almacén de vectores y
una cola abiertos al exterior en el portátil de un investigador son
exactamente lo que este proyecto existe para no hacer.

## Cómo arrancarlo

```bash
python tools/build.py indexer
```

No levanta `lumid`: el Indexer es autónomo y no necesita el daemon. En el
primer arranque, el wizard levanta Redis y Qdrant, instala el runtime de
Python (un venv con `torch`) y lista los modelos disponibles
(`lumi-preview`, `lumi-2`). El runtime solo se instala una vez: los arranques
siguientes lo detectan con `import torch` y no vuelven a invocar `pip`.

## Dónde vive todo

- `~/.lumi-indexer` por defecto (`%USERPROFILE%\.lumi-indexer` en Windows).
- `LUMI_INDEXER_DATA` fija otra ruta — útil para correr una instancia de
  pruebas sin tocar la del operador.
- Dentro: `indexer.db` (SQLite, la verdad), `maestra.key` (la clave maestra del
  equipo), `redis.conf` y `redis/` (datos de Redis), `qdrant/` (almacén de
  vectores), `runtime/venv` (el entorno de Python).

**Redis es el timbre y el estado caliente; SQLite es la verdad.** Si Redis se
vacía se pierde la barra de progreso — nunca el trabajo: la cola se
reconstruye leyendo en SQLite qué imágenes siguen sin vector.

## La estructura de un `.lumidx`

```
mi-indice.lumidx/
  manifiesto.json     nombre, modelos, las DOS procedencias (imágenes y trabajo)
  indice.db           SQLite: las imágenes y sus coordenadas
  cobertura.json       qué teselas z14 cubre este paquete, y su hash
  fragmentos/
    <quadkey z14>/
      <modelo>-<version>.b1     vectores binarios (1 bit/dimensión)
      <modelo>-<version>.i8     vectores int8 (escala fija 127)
  imagenes/            copias de referencia (se pueden recomprimir: no son
                       la prueba de un caso, el original nunca se toca)
  SHA256SUMS           un hash por fichero; abrir el paquete lo verifica ANTES
                       de tocar nada
```

**Sellar es irreversible.** Un paquete sellado no se sigue llenando, y el
Indexer se niega a declarar éxito si las filas de `indice.db` no cuadran con
los vectores de cada modelo — un paquete sellado a medias es peor que
ninguno, porque parece bueno.

**Abrir verifica, no advierte.** Si un solo fichero no cuadra con su hash en
`SHA256SUMS`, el paquete no se abre. No hay un "abrir de todas formas".

## No indexar nunca lo mismo dos veces

Antes de gastar cuota de un proveedor o una hora de GPU, el Indexer clasifica
cada tesela z14 del área dibujada en tres estados: **local** (ya en un índice
de este equipo — se referencia, no se descarga), **catálogo** (la cubre un
índice publicado — se descarga con su atribución) y **nueva** (no existe en
ningún sitio conocido — es lo único que cuesta algo).

Si un área queda enteramente cubierta, no aparece un botón de indexar
apagado: aparece el diálogo que explica qué la cubre y ofrece instalar lo que
ya existe o ajustar la selección. No hay un botón de "rehacerlo porque sí".
