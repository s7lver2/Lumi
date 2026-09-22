# Darkroom 2 — notas de las herramientas sin spec

Este archivo **no es un spec**: es el resumen de lo que se habló y se decidió en la ronda de
brainstorming del 2026-09-22 sobre las herramientas para las que no se llegó a escribir un
documento de diseño (OSINT y Car ID). Se guarda para no perder las decisiones, no como algo
listo para implementar.

Contexto: parte de `2026-09-22-darkroom2-00-indice-design.md` — herramientas 4 (OSINT) y 6
(Car ID) de la lista de specs, ambas sin redactar.

---

## Decisiones generales que sí aplican a estas dos herramientas

(Repetidas del índice, porque enmarcan todo lo de abajo.)

- Modelo plano: fuente = entrada + herramienta. Sin encadenamiento automático; «Crear fuente
  a partir de esto» es manual y guarda `derivada_de`.
- Solo existen en el backend Darkroom.
- Revisión por resultado: Sin revisar / Confirmado / Descartado.
- Auditor IA común a todas las herramientas: sugiere veredicto (probable / no concluyente /
  probable falso positivo), nunca decide; puede abstenerse; requiere calibración antes de
  activarse porque no se quieren falsos positivos.
- Local por defecto; servicios externos explícitos, habilitados por el admin uno a uno con su
  API key, y cada envío registrado en la Actividad encadenada del caso.
- Niveles Mini/Pro/Vision con papeles por herramienta en `registros/niveles/*.json`; modelos
  LLM/VLM enrutables a local, OpenRouter o un endpoint compatible con OpenAI, decidido por
  modelo y por nivel.
- Pistas de región: se muestran siempre, solo re-ponderan la geolocalización del caso al
  confirmarlas.

---

## OSINT (herramienta 4 del índice)

**Tipos de fuente decididos:** dominio, IP, usuario (alias), email, teléfono, persona (nombre
y apellidos). Los seis entraban en el spec; `persona` con tratamiento especial por
homónimos (una coincidencia nace siempre como posible, nunca como confirmada de origen).

**Módulos por tipo, con su naturaleza pasivo/activo, según la investigación:**

| Fuente | Módulo | Local/externo | Pasivo/activo |
|---|---|---|---|
| dominio | RDAP | local (Rust) | pasivo |
| dominio | crt.sh (subdominios vía certificados) | externo, gratis | pasivo |
| dominio | DNS (A/MX/TXT/NS) | local | pasivo |
| dominio | urlscan.io | externo, key con plan gratis | pasivo |
| IP | Shodan | externo, key de pago | pasivo |
| IP | ASN/organización/geo | local con base offline | pasivo |
| IP | escaneo de puertos propio | local | activo (sale con la IP del servidor) |
| usuario | maigret | local | pasivo (consulta perfiles públicos) |
| email | HIBP (filtraciones) | externo, key de pago | pasivo |
| email | holehe (en qué servicios está registrado) | local | activo (puede notificar al titular) |
| email | derivar alias → maigret | local | pasivo |
| teléfono | libphonenumber (operador/país/tipo) | local | pasivo |
| teléfono | cuentas asociadas (WhatsApp/Telegram…) | local | activo |
| persona | búsqueda web del nombre (SERP) | externo, key | pasivo |

Descartados explícitamente: **GHunt** (necesita cookie de sesión de Google → cruza la línea
"sin acceso con credenciales"), **SpiderFoot** (200 módulos de golpe, lo contrario del control
uno a uno pedido).

**Pasivo por defecto:** los módulos activos nacen apagados; el admin los habilita uno a uno;
al lanzarlos se avisa de qué hacen (p. ej. "puede notificar al titular" o "sale con la IP de
tu servidor").

**Legal:** se decidió que Lumi **no** pide base legal ni finalidad al crear una fuente de
persona — eso queda fuera del alcance de la herramienta, a diferencia de lo que se había
propuesto (pedirla una vez por caso). La trazabilidad de quién consultó qué queda solo en la
bitácora encadenada del caso (spec 2).

**IA como auditor, no como investigador:** los módulos son deterministas; un LLM local revisa
cada resultado, valora si el perfil es real o una plantilla genérica, si la bio/foto cuadra
con lo ya sabido, si un nombre es plausiblemente la misma persona o un homónimo — y da un
veredicto con motivo. Nunca decide el estado de revisión.

**Investigación de modelos/servicios (de la investigación de fondo, 2026-09-22):**
ver `investigacion-herramientas-darkroom.md` en el scratchpad de la sesión para las notas
completas por herramienta (licencias, tamaños, URLs). Candidatos de LLM local para el
auditor/planificador: Qwen 3.6 35B-A3B (MoE, ~16-24GB en Q4) o gpt-oss-20b (~16GB), ambos con
tool-calling.

---

## Car ID (herramienta 6 del índice)

**Alcance decidido:** marca/modelo/año por exterior e interior (salpicadero, volante),
lectura de matrícula, y una herramienta gemela para muebles/objetos ("Identify Object") con
la misma mecánica.

**Detección del vehículo en la imagen:** detección automática con recuadros + elección del
investigador; recorte manual disponible si el detector no lo encuentra (de noche, tapado,
solo interior). Cada vehículo detectado y elegido es su propio conjunto de resultados dentro
de la fuente. La matrícula se lee automáticamente dentro de cada recorte (ALPR local, viable
en CPU según la investigación).

**Galería de referencia:** construida por el Indexer (spec 5, sin redactar tampoco), no
prehecha por Lumi ni solo zero-shot. Orígenes decididos: Wikimedia Commons, carpeta local
etiquetada por el operador, anuncios de venta vía scrapers de terceros, Openverse, salas de
prensa de fabricantes, y búsqueda de imágenes vía SERP (más cobertura, más riesgo, se habilita
aparte). Flickr fue descartado explícitamente por el dueño.

**Anuncios de venta — dos vías que se complementan:**
1. *Matrícula → galería local*: si la matrícula leída aparece en alguna foto de anuncio ya
   indexada por el Indexer (que pasa ALPR sobre cada foto de anuncio al construir la
   galería), sale ese anuncio concreto con fecha, precio, web y fotos — sin salir del
   servidor.
2. *Modelo → mercado en vivo*: con marca/modelo/generación (y color/zona si los hay), un panel
   de mercado con anuncios recientes del mismo modelo, filtrable por **zona, proveedor, año,
   precio, kilometraje y color**, para servir como referencia de precio y posibles
   apariciones del vehículo aunque la matrícula no se vea. Lo que coincide por matrícula sale
   marcado como "este coche" arriba del todo. Esta vía es una búsqueda externa habilitada por
   el admin (servicios: SerpApi/agregadores, sin API de búsqueda oficial en AutoScout24,
   mobile.de, coches.net, Wallapop ni Milanuncios según la investigación).

**Matrícula → titular:** decidido explícitamente que **no se automatiza**. Queda como paso
manual del investigador, con un enlace a la sede electrónica de la DGT (informe de vehículo),
porque el dato del titular exige interés legítimo y directo declarado, no solo la matrícula.

**Tipo de fuente `matrícula`:** se añadiría con este spec, con su propia búsqueda en galería y
en mercado.

---

## Qué falta para que estas dos se puedan especificar y construir

- El spec 3 (infraestructura de herramientas) tiene que existir primero: registro de
  herramientas, contrato con el trabajador, gestor de VRAM, servidor de LLM/enrutado,
  servicios externos, auditor con calibración, pistas de región, detección/recorte y mercado
  son piezas compartidas que ambas usan.
- El spec 5 (Indexer: galerías) tiene que existir antes de Car ID, porque depende de él para
  la galería de vehículos.
- Ninguno de los dos specs (OSINT, Car ID) ni el 3 se llegaron a redactar en esta sesión.
