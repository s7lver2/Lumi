# Configuración de red del servidor — diseño

## Contexto

Hoy `lumid` escucha siempre en `0.0.0.0:7717` (constante `lumi_proto::PORT`, con
`LUMI_PORT` como override de entorno ya existente pero no expuesto en ningún
panel). Las claves de vinculación (`lumi1_...`) y las tarjetas de servidor
(`lumi1s_...`) incrustan `host:puerto` calculado en el momento de instalar o
reemitir (`local_ip()` + `PORT`, en `crates/lumi-cli`), sin que el
administrador pueda elegir un host distinto (dominio, IP pública tras NAT) ni
un puerto distinto del de escucha real (para port-forwarding o proxy TCP).

Esta spec cubre tres piezas relacionadas: hacer configurable esa
dirección/puerto públicos, resolver qué pasa con clientes que ya tenían la
dirección vieja guardada cuando cambia, y añadir un transporte QUIC/HTTP3
opcional del lado servidor.

**Fuera de alcance:** reemplazar TCP+TLS por QUIC como transporte único. El
cliente Tauri actual usa `reqwest`, cuyo soporte de HTTP/3 no es estable hoy;
forzar un reemplazo total ataría esta feature a una pieza del ecosistema que
todavía se mueve. QUIC queda como capacidad adicional que el servidor ofrece,
no como sustituto.

## 1. Ajustes de red

Cinco escalares nuevos en la tabla `meta` (mismo patrón que
`mantenimiento`/`mantenimiento_mensaje` en `crates/lumid/src/mantenimiento.rs`
— no hace falta una tabla nueva para esto):

| Clave | Significado | Por defecto |
|---|---|---|
| `red_bind_port` | Puerto TCP local de escucha de `lumid` | `7717` |
| `red_public_host` | Host incrustado en claves/tarjetas nuevas (dominio o IP) | IP LAN autodetectada (como hoy) |
| `red_public_port` | Puerto incrustado en claves/tarjetas nuevas | igual a `red_bind_port` |
| `red_quic_enabled` | Si el listener QUIC adicional está activo | `false` |
| `red_quic_port` | Puerto UDP del listener QUIC | igual a `red_bind_port` |

`public_host`/`public_port` existen separados de `bind_port` precisamente
para el caso de NAT/port-forwarding/proxy TCP transparente: el daemon puede
escuchar en `0.0.0.0:7717` mientras el router expone `midominio.com:9000`
hacia fuera, y es esa segunda combinación la que se incrusta en claves y
tarjetas nuevas.

`LUMI_PORT` (env) se mantiene como override de emergencia: si está presente,
gana sobre `red_bind_port`. Es la misma vía que ya se usó para depurar el
freeze del daemon esta sesión; quitarla sería perder una escotilla de
recuperación ya probada.

**Efectivo en:**
- `crates/lumid/src/main.rs`: el puerto de bind pasa a resolverse
  `LUMI_PORT` (env) → `red_bind_port` (meta) → `lumi_proto::PORT` (7717).
- `crates/lumi-cli/src/install.rs` (`run()` y `reissue()`) y
  `crates/lumi-cli/src/admin.rs` (`card()`): el cálculo de `addr` para nuevas
  claves/tarjetas pasa a leer `red_public_host`/`red_public_port` de la
  tabla `meta` (consulta SQL directa, igual que ya hacen hoy con el resto de
  columnas — estos binarios no pasan por la API de `lumid`), cayendo a
  `local_ip()` + `red_bind_port` si no hay valor guardado.
- Nuevo `GET/PATCH /v1/admin/network` en `lumid`, y una vista "Red" en el
  panel de admin con los cinco campos y, para que el admin no necesite SSH
  para recuperar una tarjeta tras un cambio, el `ServerCard` actual (host +
  huella efectivos) con botón de copiar.

**Reinicio:** cambiar `red_bind_port`/`red_quic_enabled`/`red_quic_port`
exige rebindear el socket, y eso exige reiniciar el proceso — no se puede
recablear en caliente. El panel guarda el cambio marcado como "pendiente de
reinicio" y ofrece un botón "Reiniciar ahora". Ese botón se bloquea (con
motivo visible, mismo patrón que la matriz de capacidades) si
`SELECT COUNT(*) FROM analyses WHERE state = 'en_curso'` es mayor que cero —
coherente con la regla ya establecida de que un análisis en ejecución nunca
se cancela. Cambiar solo `public_host`/`public_port` no requiere reinicio: no
afecta al bind, solo a lo que se incrusta en claves nuevas a partir de ahora.

## 2. Compatibilidad con clientes que ya tienen la dirección guardada

El cliente guarda `addr` + `fingerprint` en `localStorage` (`session.ts`) y
reconecta con eso, no con la clave de vinculación original (de un solo uso).
Cambiar `bind_port`/`public_host`/`public_port` puede dejar esa dirección
guardada apuntando a un sitio que ya no responde. Se resuelve distinto según
si el cliente está conectado en el momento del cambio:

**Clientes conectados:** al pulsar "Reiniciar ahora", y ANTES de reiniciar
(mientras el daemon sigue vivo en la dirección vieja), se difunde un nuevo
variante de `Cambio` (`lumi-proto::api`, mismo enum que ya tiene `Estado`,
`Progreso`, `Invitacion`):

```rust
Red {
    #[serde(skip)]
    user_id: i64,
    nuevo_addr: String,
},
```

emitido a través de `queue.difundir(...)` para cada sesión conectada (mismo
mecanismo que `Invitacion`), con una espera corta (constante `AVISO_ANTES_DE_REINICIAR
= Duration::from_secs(5)`) entre difundir el aviso y ejecutar el reinicio
real, para dar tiempo a que el SSE lo entregue antes de que la conexión se
corte. El cliente, al recibir `tipo: "red"` sobre `queue-change`, actualiza en
silencio `session.addr` y la entrada correspondiente en la lista de
servidores recordados (la huella no cambia — mismo certificado, no ha habido
rotación), y muestra un toast: "El servidor se movió a `<nuevo_addr>`."

**Clientes desconectados en ese momento:** al reabrir la app, `reconnect()`
falla contra la dirección vieja — mismo síntoma que cualquier corte de red
hoy, no un caso nuevo que resolver a nivel de protocolo. La recuperación ya
existe: pedir al admin una tarjeta de servidor (`lumi1s_...`, ahora visible
directamente en el panel — ver sección 1) y añadirla de nuevo desde "Añadir
servidor" (`AddServerForm.tsx`), que ya soporta esto sin cambios. Lo único
que se añade es una pista en el mensaje de error de reconexión fallida:
"¿Cambió de dirección el servidor? Pide una tarjeta nueva y añádela" —
para que la vía de recuperación sea descubrible en vez de tener que
saberla de antemano.

## 3. QUIC/HTTP3 opcional

Nuevo listener del lado servidor usando `quinn` (transporte QUIC) + `h3` +
`h3-quinn` (HTTP/3 sobre QUIC), activado por `red_quic_enabled` y escuchando
en `red_quic_port` (UDP). Usa el mismo certificado que el listener TCP+TLS
actual, así que la huella que ancla la clave de vinculación es la misma
huella para ambos transportes — no hay un segundo certificado que verificar.

**Límite que se acepta explícitamente:** `reqwest` (el cliente HTTP del lado
`client/src-tauri`) no tiene soporte estable de HTTP/3 hoy. El cliente oficial
de Lumi Station seguirá hablando TCP+TLS exclusivamente. Encender
`red_quic_enabled` no cambia nada para ese cliente — es infraestructura para
consumidores futuros (herramientas de terceros, o cuando `reqwest`/`hyper`
maduren su soporte HTTP/3), anunciada como capacidad en `/v1/hello`
(`capabilities: [{ id: "quic", state: "on"|"off", reason }]`, mismo patrón
que el resto de la matriz) para que quien mire esa respuesta sepa que existe
sin que el panel finja una mejora de rendimiento que no ocurre todavía.

## Fuera de alcance (anotar en FUTURO.md)

- Reemplazo total de TCP+TLS por QUIC como transporte único.
- Proxies TLS-*terminating* (un proxy que descifra y vuelve a cifrar rompería
  el anclaje de huella; el diseño asume proxies/port-forwarding transparentes
  a nivel TCP, que es el caso real de uso — NAT casero, port-forward de
  router).
- Actualizar `reqwest`/el cliente Tauri a HTTP/3 cuando el ecosistema madure.
