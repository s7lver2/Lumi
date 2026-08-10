# Lumi Station — contexto de producto

## Qué es

Herramienta de geolocalización de imágenes por inferencia, de código abierto, para uso
forense y de investigación. Compite con GeoSpy y Raven, pero abierta y autoalojada: el
propietario pone sus propias GPUs.

Reescritura completa de Lumi v1 (monorepo Next.js + servicio Python). La v2 separa un
**cliente de escritorio Tauri** de un **servidor de inferencia** que el propietario despliega
en su propia máquina.

## Register

`product` — la interfaz sirve al trabajo, no es el producto. Nada de páginas de marketing.

## Usuarios

**Owner.** Despliega y paga el hardware. Tiene shell en el servidor. Ejecuta el CLI,
canjea la clave de vinculación y se convierte en el primer administrador.

**Administrador.** Gestiona el servidor desde el cliente: crea usuarios, aprueba
solicitudes de acceso, fija límites globales y por usuario, instala modelos, controla qué
usuario usa qué modelo, monitoriza hardware, envía notificaciones y pone el servidor en
mantenimiento. No puede leer contraseñas: solo solicitar que se cambien.

**Investigador.** Introduce la IP del servidor, solicita acceso, y al ser aprobado crea su
cuenta. Trabaja en **proyectos**: entornos de trabajo persistentes al estilo Burp Suite o
Caido, donde quedan sus imágenes y análisis anteriores.

## Tono

Español, minúscula en los subtítulos, frases cortas. Precisión sobre entusiasmo: es una
herramienta con la que se toman decisiones que afectan a personas reales. Nunca ocultar un
fallo tras un mensaje amable. Cuando algo se degrada, decir exactamente qué se perdió y qué
no.

## Principios

**Nada desaparece en silencio.** Una función no disponible se muestra deshabilitada con el
motivo real, nunca se oculta. El servidor publica una matriz de capacidades donde cada
recorte lleva su `reason`.

**El estado del servidor es visible siempre.** La franja de telemetría aparece en el momento
en que se verifica la identidad del servidor y no se va. La máquina remota es tangible.

**Honestidad criptográfica.** No se promete cifrado extremo a extremo: el servidor tiene que
ver el píxel en claro para inferir. Se documenta exactamente contra qué protege el cifrado y
contra qué no.

**El log crudo está a un clic.** Cuando algo falla, el `stderr` real se muestra dentro de la
interfaz, no detrás de un código de error.

**Un análisis puede devolver más de una respuesta.** Cuando el motor no logra que los
candidatos se pongan de acuerdo, no elige por su cuenta ni se niega a contestar: entrega la
zona dominante como respuesta principal y las demás como alternativas, cada una con su peso y
con qué índice y qué autor la respaldan. Que aparezcan alternativas es en sí la señal de que el
motor duda — más honesto que un único punto con falsa seguridad, y más útil que un silencio.

## Anti-referencias

- Paneles de admin tipo SaaS con tarjetas de métrica gigante y acento en gradiente.
- Interfaces que esconden la complejidad del hardware detrás de una barra de progreso.
- Herramientas forenses que presumen de seguridad sin explicar el modelo de amenaza.
- Consolas de sysadmin: el investigador no es un operador de infraestructura.

## Fuera de alcance

Multi-tenencia entre organizaciones. Facturación. Móvil. Inferencia en el cliente.
