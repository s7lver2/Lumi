# Servidor · API Keys y Zero Trust

**Fecha:** 2026-08-15
**Estado:** aprobado, pendiente de plan
**Mockup:** `docs/superpowers/specs/lumi-api-keys-mockup.html` (interactivo)

## 1. Qué resuelve

`KeysView.tsx`/`MapRow.tsx` son hoy «PROVISIONAL: el subsistema 3 rehace el panel entero» — un
input enmascarado + botón «Guardar» para la clave de Mapbox, y nada para el proveedor de pesos
salvo un campo vacío. No hay ningún camino para que un sistema externo (un script, una
integración) llame a la API HTTP de Lumi Station: solo existen sesiones de usuario nacidas de un
login con usuario y contraseña.

Este ciclo trae dos cosas relacionadas pero independientes:

1. **Rediseño de las credenciales de terceros** que el servidor ya guarda (mapa, pesos), al patrón
   fila con valor truncado + botón de rotar.
2. **Claves de API**: un usuario (o un administrador en su nombre) puede emitir una clave para
   llamar a la API programáticamente, con el mismo alcance que su propia sesión. Trae consigo un
   modo **Zero Trust** opcional que restringe esas claves por IP de origen y por clase de
   dispositivo declarada.

## 2. Alcance

**Dentro:**

- Rediseño de las filas de «Proveedor de mapas» y «Proveedor de pesos» en `API Keys`.
- Tabla admin de **todas** las claves de API del servidor (de cualquier usuario, o de una
  identidad de sistema sin persona detrás): emitir, ver, revocar.
- Nueva sección **Seguridad** en la barra lateral (grupo Servidor): el interruptor de Modo Zero
  Trust y el de autoservicio de IP.
- Listas globales de IP (blanca/negra), visibles en `API Keys`, activas solo con Zero Trust.
- Por clave: IPs autorizadas propias, y clases de dispositivo permitidas (comprobación por
  cabeceras, no criptográfica).
- Nueva pantalla **Perfil y sesiones** (autoservicio, fuera del panel admin): mis propias claves
  de API, y mis sesiones/dispositivos activos con opción de cerrar cualquiera en remoto. Esto
  activa por primera vez el hueco `onProfile` que `TitleBar.tsx` ya declara pero nadie conecta.
- Iconos en toda la barra lateral del panel admin (hoy es texto plano).

**Fuera, y por qué:**

- **Certificados por dispositivo (mTLS) o secretos de dispositivo emparejados.** Se evaluaron
  como alternativas más fuertes a la comprobación por cabeceras y se descartaron para este ciclo:
  exigen un paso de aprovisionamiento por dispositivo que no vale la pena hasta que la
  comprobación heurística demuestre que no basta.
- **Editar el perfil (nombre, avatar, contraseña) desde «Perfil y sesiones».** La pantalla nace
  solo con claves de API y sesiones; el cambio de contraseña ya tiene su propio flujo forzado
  (`ChangePasswordForm.tsx`) y no se toca aquí.
- **Zero Trust sobre las sesiones de usuario (login interactivo).** Solo afecta a claves de API.
  Investigadores en campo no tienen IP estable; forzarlo ahí es un problema sin pedir.
- **Scopes/permisos parciales por clave** (p. ej. «solo lectura»). Una clave actúa exactamente
  como su dueño, sin excepción — no existe hoy ningún modelo de permisos más fino que
  `is_admin`, y construir uno sería un subsistema propio.

## 3. Mecanismo: reusar `sessions`, no un sistema paralelo

Una clave de API es una fila más en `sessions` (`kind = 'api_key'` junto al `'login'` de
siempre), no una tabla nueva. Motivo: `require_session`/`require_admin` ya hacen exactamente lo
que hace falta — mirar un bearer token contra esta tabla y traer el usuario — y no hay ninguna
diferencia de permisos entre «estás usando el cliente» y «estás usando tu clave» que justifique
un camino de autenticación aparte. Revocar una clave es borrar su fila, igual que ya pasa con
una sesión.

Columnas nuevas sobre `sessions`: `label TEXT`, `kind TEXT` (`'login' | 'api_key'`), `ips TEXT`
(JSON, lista de IP/CIDR propias de esta clave), `devices TEXT` (JSON, clases permitidas). El
`device_id` existente queda `NULL` para una clave: no es un dispositivo registrado del cliente,
es el propio mecanismo de auth.

**Identidad de sistema.** Una clave admin-emitida sin persona detrás (p. ej. una integración de
automatización) es un usuario más en `users`, con una columna `is_service = 1`: sin contraseña
utilizable, nunca puede entrar por el formulario de login, solo existe para que sus claves
tengan un `user_id` al que colgarse. Ningún concepto nuevo — la tabla de usuarios ya alcanza.

## 4. Zero Trust: qué activa y qué no

Un interruptor de servidor (`ajustes` o tabla equivalente, una fila). Mientras está OFF:

- Las claves funcionan desde cualquier IP, cualquier dispositivo — el comportamiento de hoy.
- Las IPs por clave y las listas globales de blanca/negra se pueden seguir editando y se
  guardan, pero no se consultan en el camino de autenticación. Esto deja preparar la
  configuración antes de encender el interruptor, en vez de tener que rellenarla a ciegas
  justo cuando ya está aplicándose.

Al activarlo, cada petición autenticada con una clave de API comprueba, en este orden:

1. **Lista negra global** — si la IP de origen está aquí, `403` sin mirar nada más. Se aplica
   TAMBIÉN con Zero Trust apagado: una IP conocida como hostil se bloquea siempre, no es
   condicional.
2. **Lista blanca global** — si la IP está aquí, pasa, sin mirar la lista de la propia clave.
3. **IPs propias de la clave** — si la clave no tiene ninguna declarada, pasa (equivale a
   «cualquier IP», el mismo criterio que hoy sin Zero Trust). Si tiene alguna y la IP de origen
   no está en ninguna de ellas, `403`.
4. **Clase de dispositivo** — si la clave declaró alguna clase permitida, las cabeceras de la
   petición (User-Agent, y `Sec-CH-UA-*` cuando el cliente las manda) se clasifican en una de
   `navegador | cli · script | servidor backend | móvil`; si no encajan con ninguna de las
   declaradas, `403`. Sin clases declaradas, cualquier dispositivo pasa. Esto es una
   comprobación de **coherencia**, no una prueba criptográfica — un cliente que falsee sus
   cabeceras la pasa igual, y así se dice en la propia interfaz (nota en el campo, no letra
   pequeña en un aparte).

**Autoservicio de IP** — un segundo interruptor, **inerte mientras Zero Trust está apagado**
(atenuado en la interfaz, con la razón, la misma regla que la matriz de capacidades): controla
si un usuario normal puede editar la lista de IPs de SUS PROPIAS claves desde «Perfil y
sesiones», o si eso queda reservado al administrador incluso para las claves de otros. Un
administrador emitiendo una clave para otro siempre puede fijar sus IPs, este interruptor solo
gobierna el autoservicio.

## 5. Navegación

Grupo **Servidor** en la barra lateral pasa de `Resumen · Modelos · Índices · API Keys` a
`Resumen · Modelos · Índices · Seguridad · API Keys` — Seguridad justo antes porque gobierna lo
que sigue. Lleva un punto que se enciende cuando Zero Trust está activo, visible sin entrar a la
sección. El resto de entradas ganan icono (hoy es texto plano); el propio mockup fija el trazo
(`viewBox 0 0 24 24`, `stroke-width 1.8`, esquinas redondeadas — el mismo criterio que
`Icon.tsx`).

`API Keys` mantiene las credenciales de terceros, las listas globales de IP (colapsadas con
nota + enlace a Seguridad cuando Zero Trust está apagado) y la tabla de todas las claves.
`Seguridad` trae solo los dos interruptores — nada de listas ahí, para no duplicar dónde se
edita cada cosa.

`Perfil y sesiones` es una pantalla nueva, fuera del panel admin, colgada del hueco `onProfile`
de `TitleBar.tsx`. Trae **mis claves de API** (mismo patrón de fila, con el mismo flujo de
crear/revelar-una-vez/revocar, sin columna de dueño porque siempre es una misma) y **mis
sesiones activas** (dispositivos con sesión abierta, con «cerrar sesión» remoto salvo en el
propio dispositivo actual).

## 6. Interfaz por pantalla

### API Keys → Credenciales de terceros

Fila por credencial (mapa, pesos): etiqueta, valor truncado en mono o «sin configurar», botón
Rotar/Añadir que despliega un input in-line (mismo patrón para las dos, a diferencia de hoy que
solo el mapa lo tiene medio resuelto).

### API Keys → Listas globales de IP

Dos listas (blanca, negra) de chips con IP/CIDR, añadir por input + Enter o botón, quitar por
chip. Colapsadas con una nota de una línea + enlace a Seguridad mientras Zero Trust está
apagado.

### API Keys → Claves de API (tabla admin)

Columnas: dueño (avatar+nombre, o icono de sistema con recuadro discontinuo), clave (etiqueta +
prefijo truncado en mono), IP (badge con la cuenta, o «cualquiera» en cursiva; el detalle
completo al pasar el ratón), dispositivos (icono por clase, atenuado si no está permitida),
último uso, acción de revocar (pide confirmación in-line antes de borrar, la fila sale con una
animación al desaparecer). Botón «Emitir clave» abre el modal de creación.

### Modal: emitir clave

Un solo paso de formulario:

- **Para** (solo si no es autoservicio): usuario existente (lista con avatar) o identidad de
  sistema (nombre libre).
- **Etiqueta** — texto libre.
- **Caduca** — 90 días (por defecto), 1 año, o nunca.
- **Dispositivos permitidos** — chips multi-selección de las cuatro clases.
- **IPs autorizadas** — chips + input, solo editable si Zero Trust está activo y (es
  autoservicio con el interruptor puesto, o es un admin emitiendo para otro); si no, nota
  explicando por qué está bloqueado.

Al confirmar, pantalla de **revelar una vez**: la clave completa en mono, botón copiar con
confirmación visual, y un aviso corto de que es la única vez que se muestra. Al cerrar, la fila
nueva entra en la tabla con una animación de resalte.

### Perfil y sesiones

Mismo patrón de tabla que la admin, pero sin columna de dueño y siempre en modo autoservicio
(sujeto al interruptor de autoservicio de IP). Debajo, sesiones activas: dispositivo, cuándo se
vio, «cerrar sesión» remoto — deshabilitado con nota en la fila del dispositivo actual.

## 7. Consecuencias en los documentos

- `CLAUDE.md`: el subsistema 3 deja de tener «API Keys» descrita solo como credenciales de
  terceros; se anota que ahora también emite claves de programa y trae Zero Trust.
- `FUTURO.md`: entra «mTLS/secreto de dispositivo por clave» como alternativa más fuerte a la
  comprobación por cabeceras, aparcada hasta que la heurística demuestre que no basta; entra
  también «editar perfil (nombre, contraseña) desde Perfil y sesiones» como su propia extensión
  futura de esa misma pantalla.
