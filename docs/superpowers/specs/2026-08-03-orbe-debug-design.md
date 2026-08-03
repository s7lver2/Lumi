# Orbe de debug (solo desarrollo)

**Fecha:** 2026-08-03
**Estado:** aprobado
**Alcance:** herramienta de desarrollo para simular varios "dispositivos" sin reinstalar ni borrar `localStorage` a mano.

---

## 1. Decisión

Un entorno (`env N`) es un namespace de `localStorage`: cada uno tiene su propia sesión, sus
propios servidores recordados y su propio `deviceId`, así que se comporta exactamente como un
dispositivo que nunca ha abierto la app — útil para probar el registro de dispositivos
(subsistema 2) o varios roles (admin/usuario/bloqueado) sin relogear cada vez a mano.

Cambiar de entorno **recarga la ventana**. No se reconstruye el store en caliente: `App.tsx`
ya tiene toda la lógica de arranque (resume, reconexión, `hello.state`); dejar que corra desde
cero contra el namespace nuevo es menos código y menos superficie de bugs que duplicarla.

**Solo existe en desarrollo.** `import.meta.env.DEV` es una constante que Vite sustituye en
build de producción; el bloque entero (componente y su render) se elimina del bundle final por
dead-code-elimination — no es una comprobación en runtime que alguien pueda burlar, es código
que **no está** en el binario de release.

## 2. Namespacing

`env "1"` (el defecto) usa las claves de siempre sin sufijo, para no invalidar sesiones que ya
existan de pruebas anteriores. Cualquier otro número sufija: `lumi.session::3`, `lumi.servers::3`,
`lumi.device::3`. Qué entorno está activo vive en una clave **sin sufijo**, `lumi.env`.

## 3. Comandos

| Comando | Efecto |
|---|---|
| `env N` | Cambia al entorno `N` y recarga |
| `env` | Muestra cuál está activo, sin recargar |
| `reset` | Borra las claves del entorno activo y recarga (mismo entorno, en blanco) |

## 4. Interfaz

Bolita fija en la esquina inferior derecha, tokens de `DESIGN.md`. Clic la expande en una
cajita con un input de una línea; `Enter` ejecuta el comando y muestra el resultado o el
error debajo. Nada de esto se diseña "para durar" — es una herramienta, no una pantalla de
producto.
