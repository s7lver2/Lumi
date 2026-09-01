// Import ES real, no `window.__TAURI__` — ese global solo existe si
// `app.withGlobalTauri` está a `true` en tauri.conf.json, y la plantilla
// clonada de `indexer/` no lo tiene así. `@tauri-apps/api` ya es
// dependencia (viene del `package.json` clonado).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

const ventana = getCurrentWindow();
document.getElementById("btn-minimizar").addEventListener("click", () => void ventana.minimize());
document.getElementById("btn-cerrar").addEventListener("click", () => void ventana.close());

const PANTALLAS = ["p_bienvenida", "p_productos", "p_ubicacion", "p_opciones", "p_instalando"];
let indice = 0;
// Placeholder solo hasta que resolverRutaPorDefecto() la reemplace por la
// ruta real — nunca se manda a `instalar` tal cual (Rust no expande
// sintaxis de variables de entorno de cmd.exe: mandado literal, creaba una
// carpeta llamada "%LocalAppData%" donde se hubiera lanzado el instalador).
let raiz = "%LocalAppData%\\Programs\\Lumi";

async function resolverRutaPorDefecto() {
  raiz = await invoke("ruta_instalacion_por_defecto");
  document.getElementById("ruta-destino").textContent = raiz;
}
const seleccion = new Set(["cliente", "indexer"]);
const opciones = new Set(["acceso_directo"]);
// Pestaña "Otros": producto -> versión exacta a instalar en vez de "la más
// nueva". Elegir una versión concreta aquí y marcar la tarjeta normal del
// mismo producto son excluyentes — no tiene sentido pedir "la última" y
// "exactamente 2.0.1" a la vez.
const versionesExactas = new Map();

const btnAtras = document.getElementById("btn-atras");
const btnSiguiente = document.getElementById("btn-siguiente");

function mostrar(i) {
  PANTALLAS.forEach((id, n) => {
    document.getElementById(id).classList.toggle("active", n === i);
  });
  btnAtras.style.visibility = i === 0 ? "hidden" : "visible";
  // Nunca dice "Instalar": llegar a la última pantalla ya dispara la
  // instalación sola (ver `irA`), así que no hay ninguna acción pendiente
  // que ese texto describiera — solo confundía a quien esperaba que
  // "Siguiente" tras Opciones ya fuera instalar, y le tocaba pulsar otra vez.
  btnSiguiente.textContent = "Siguiente";
  document.getElementById("progreso-pasos-fill").style.width = `${((i + 1) / PANTALLAS.length) * 100}%`;
}

// Pantalla de carga: solo se forma el logo — la estrella entra, sale
// "Lumi", aparece el indicador de carga, y ese mismo grupo (estrella +
// texto) vuela a su tamaño y posicion reales en la barra de titulo — no
// una animacion generica, es el mismo elemento encogiendose hasta
// convertirse en la marca de la barra.
function jugar(id) {
  const el = document.getElementById(id);
  el.classList.remove("jugar");
  void el.offsetWidth; // fuerza el reflow para poder reiniciar la animacion
  el.classList.add("jugar");
}

const T_LOGO = 950; // "Lumi" + el indicador de carga, antes de volar al titulo
const T_VUELO = 480; // duracion de la propia animacion de vuelo

jugar("estrella-final");
jugar("carga-marca-texto");
jugar("carga-loader");

setTimeout(volarAlTitulo, T_LOGO);

function volarAlTitulo() {
  const grupo = document.getElementById("grupo-logo");
  const estrella = document.getElementById("estrella-final");
  const destino = document.querySelector(".titlebar .marca-mini svg");

  const rGrupo = grupo.getBoundingClientRect();
  const rEstrella = estrella.getBoundingClientRect();
  const rDestino = destino.getBoundingClientRect();

  // El origen real del escalado es la estrella, no el centro de todo el
  // grupo (que incluye "Lumi" y el indicador debajo) — si no, la estrella
  // se desplazaria de mas al encoger alrededor del centro del grupo entero.
  const origenXPct = ((rEstrella.left + rEstrella.width / 2 - rGrupo.left) / rGrupo.width) * 100;
  const origenYPct = ((rEstrella.top + rEstrella.height / 2 - rGrupo.top) / rGrupo.height) * 100;
  grupo.style.transformOrigin = `${origenXPct}% ${origenYPct}%`;

  const escala = rDestino.width / rEstrella.width;
  const dx = rDestino.left + rDestino.width / 2 - (rEstrella.left + rEstrella.width / 2);
  const dy = rDestino.top + rDestino.height / 2 - (rEstrella.top + rEstrella.height / 2);

  grupo.style.transform = `translate(${dx}px, ${dy}px) scale(${escala})`;
  grupo.classList.add("volando");
  // El texto y el indicador de carga no vuelan con la estrella: solo
  // encogen y se desvanecen en el sitio, para que lo unico que "llega" a
  // la barra de titulo sea la estrella — igual que el destino real.
  document.querySelector(".carga-marca").style.opacity = "0";
  document.querySelector(".carga-loader").style.opacity = "0";

  setTimeout(() => {
    document.getElementById("p_carga").classList.add("oculto");
  }, T_VUELO);
}

document.querySelectorAll(".product-card[data-producto]").forEach((tarjeta) => {
  tarjeta.addEventListener("click", () => {
    // Ya instalado no bloquea el clic: sigue seleccionable a propósito,
    // para poder reinstalar/sobrescribir si hace falta (una versión rota,
    // un archivo corrupto). Por defecto llega desmarcado (pintarEstadoInstalados),
    // así que no se pisa nada sin que el investigador lo pida.
    const producto = tarjeta.dataset.producto;
    const casilla = tarjeta.querySelector(".checkbox");
    if (seleccion.has(producto)) {
      seleccion.delete(producto);
      casilla.classList.remove("checked");
    } else {
      seleccion.add(producto);
      casilla.classList.add("checked");
      // Esta tarjeta pide "la más nueva" — si Otros tenía una versión
      // concreta fijada para el mismo producto, deja de aplicar.
      versionesExactas.delete(producto);
      pintarSeleccionOtros();
    }
  });
});

// Popup aparte (no una lista desplegada bajo las tarjetas): panel lateral
// para elegir el producto, lista de versiones de ESE producto a la derecha.
let todasLasVersiones = null;
let productoActivoOtros = "cliente";
const NOMBRE_PRODUCTO = { cliente: "Lumi Client", indexer: "Lumi Indexer" };

document.getElementById("btn-otros-toggle").addEventListener("click", async () => {
  document.getElementById("modal-otros").style.display = "flex";
  if (!todasLasVersiones) {
    const lista = document.getElementById("lista-otros");
    lista.innerHTML = `<div class="version-row"><span class="sub">Cargando…</span></div>`;
    try {
      todasLasVersiones = await invoke("listar_versiones_disponibles");
    } catch (err) {
      lista.innerHTML = `<div class="version-row"><span class="sub">No se pudo pedir la lista: ${String(err)}</span></div>`;
      return;
    }
  }
  pintarListaOtros();
});

document.getElementById("btn-otros-cerrar").addEventListener("click", () => {
  document.getElementById("modal-otros").style.display = "none";
});
// Clic en el fondo oscurecido (fuera de la tarjeta) también cierra.
document.getElementById("modal-otros").addEventListener("click", (e) => {
  if (e.target.id === "modal-otros") e.currentTarget.style.display = "none";
});

document.querySelectorAll(".modal-otros-producto[data-producto]").forEach((boton) => {
  boton.addEventListener("click", () => {
    productoActivoOtros = boton.dataset.producto;
    document.querySelectorAll(".modal-otros-producto").forEach((b) => b.classList.toggle("activo", b === boton));
    pintarListaOtros();
  });
});

function pintarListaOtros() {
  const lista = document.getElementById("lista-otros");
  lista.innerHTML = "";
  const versiones = (todasLasVersiones ?? []).filter((v) => v.producto === productoActivoOtros);
  if (versiones.length === 0) {
    lista.innerHTML = `<div class="version-row"><span class="sub">Sin publicaciones todavía.</span></div>`;
    return;
  }
  for (const v of versiones) {
    const fila = document.createElement("div");
    fila.className = "version-row";
    fila.dataset.producto = v.producto;
    fila.dataset.version = v.version;
    const fecha = new Date(v.publicado).toLocaleDateString();
    fila.innerHTML = `
      <div class="info">
        <div class="label">${NOMBRE_PRODUCTO[v.producto] ?? v.producto} v${v.version}${v.retirada ? " · retirada" : ""}</div>
        <div class="sub">${v.notas ? v.notas : ""}</div>
      </div>
      <span class="fecha">${fecha}</span>
    `;
    fila.addEventListener("click", () => {
      const yaFijada = versionesExactas.get(v.producto) === v.version;
      if (yaFijada) {
        versionesExactas.delete(v.producto);
      } else {
        versionesExactas.set(v.producto, v.version);
        seleccion.add(v.producto);
        // La tarjeta normal pasa a mostrarse desmarcada: la versión que se
        // va a instalar ahora la decide esta fila, no "la más nueva".
        const casilla = document.querySelector(`.product-card[data-producto="${v.producto}"] .checkbox`);
        casilla?.classList.remove("checked");
      }
      pintarSeleccionOtros();
    });
    lista.appendChild(fila);
  }
}

function pintarSeleccionOtros() {
  document.querySelectorAll(".version-row").forEach((fila) => {
    const fijada = versionesExactas.get(fila.dataset.producto) === fila.dataset.version;
    fila.classList.toggle("seleccionada", fijada);
  });
}

// La casilla de atajos de terminal depende de la de PATH — sin PATH el
// comando no se encontraría, así que se muestra deshabilitada con el
// motivo en vez de escondida (mismo patrón de capacidad-con-razón que ya
// usa el resto del producto).
function sincronizarDependenciaAtajos() {
  const filaAtajos = document.querySelector('.option-row[data-opcion="atajos_terminal"]');
  const puedeUsarAtajos = opciones.has("agregar_path");
  filaAtajos.classList.toggle("disabled", !puedeUsarAtajos);
  if (!puedeUsarAtajos && opciones.has("atajos_terminal")) {
    opciones.delete("atajos_terminal");
    filaAtajos.querySelector(".checkbox").classList.remove("checked");
  }
}

document.querySelectorAll(".option-row[data-opcion]").forEach((fila) => {
  fila.addEventListener("click", () => {
    if (fila.classList.contains("disabled")) return;
    const opcion = fila.dataset.opcion;
    const casilla = fila.querySelector(".checkbox");
    if (opciones.has(opcion)) {
      opciones.delete(opcion);
      casilla.classList.remove("checked");
    } else {
      opciones.add(opcion);
      casilla.classList.add("checked");
    }
    sincronizarDependenciaAtajos();
  });
});

document.getElementById("btn-examinar").addEventListener("click", async () => {
  const elegida = await open({ directory: true, multiple: false });
  if (elegida) {
    raiz = elegida;
    document.getElementById("ruta-destino").textContent = raiz;
  }
});

async function pintarEstadoInstalados() {
  const info = await invoke("detectar_instalados");
  for (const item of info) {
    const sub = document.querySelector(`[data-estado="${item.producto}"]`);
    if (item.ya_instalado) {
      const desactualizado = item.version_disponible && item.version_disponible !== item.version;
      // `version_disponible` es `null` sin red — no se muestra la
      // comparación en ese caso, no tiene sentido inventar un "última: ?".
      const comparacion = item.version_disponible
        ? ` · última ${item.version_disponible}${desactualizado ? " ⚠" : ""}`
        : "";
      sub.textContent = `Instalada ${item.version}${comparacion} — clic para reinstalar`;
      const tarjeta = document.querySelector(`.product-card[data-producto="${item.producto}"]`);
      tarjeta.classList.add("instalado");
      tarjeta.querySelector(".checkbox").classList.remove("checked");
      seleccion.delete(item.producto);
    } else if (item.version_disponible) {
      sub.textContent = `última versión: ${item.version_disponible}`;
    }
  }
}

// Tres fases por producto, mismo orden en el que las emite `aplicar.rs`. El
// progreso global es el paso actual (producto × fase) sobre el total de
// pasos de TODOS los productos elegidos — no el porcentaje de un producto
// suelto, que reiniciaba a 33% cada vez que empezaba el siguiente y parecía
// ir hacia atrás.
const FASES = ["descargando", "verificando", "copiando"];

function formatearTiempo(segundos) {
  if (segundos < 60) return `${segundos}s`;
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${min}m ${seg}s`;
}

async function ejecutarInstalacion() {
  document.getElementById("btn-siguiente").disabled = true;
  document.getElementById("btn-atras").style.visibility = "hidden";

  const estado = document.getElementById("estado-texto");
  const texto = estado.querySelector(".texto");
  const tiempoRestante = document.getElementById("tiempo-restante");
  const barra = document.getElementById("barra");
  const icono = document.getElementById("icono-estado");
  estado.classList.add("activo");
  icono.className = "icono-estado en-curso";

  const productos = [...seleccion];
  const totalPasos = productos.length * FASES.length;
  const inicio = Date.now();
  // Nunca hacia atrás ni se reinicia: cada paso nuevo solo puede subir el
  // máximo ya alcanzado, aunque un evento llegase desordenado.
  let pasoMax = 0;

  const cancelarEscucha = await listen("progreso", (evento) => {
    const { producto, fase } = evento.payload;
    const indiceProducto = productos.indexOf(producto);
    const indiceFase = FASES.indexOf(fase);
    if (indiceProducto >= 0 && indiceFase >= 0) {
      pasoMax = Math.max(pasoMax, indiceProducto * FASES.length + indiceFase + 1);
    }

    texto.textContent = `${producto}: ${fase}`;
    // Se detiene en 99%, no en 100%: el 100% real lo pone el `try` de abajo
    // al confirmar que `invoke("instalar")` terminó de verdad, no una
    // estimación que podría llegar antes de que el último archivo se copie.
    barra.style.width = `${Math.min(99, Math.round((pasoMax / totalPasos) * 100))}%`;

    if (pasoMax > 0) {
      const transcurridoS = (Date.now() - inicio) / 1000;
      const ritmoPorPaso = transcurridoS / pasoMax;
      const restanteS = Math.round(ritmoPorPaso * (totalPasos - pasoMax));
      tiempoRestante.textContent = restanteS > 1 ? `~${formatearTiempo(restanteS)} restantes` : "";
    }
  });

  try {
    await invoke("instalar", {
      productos,
      raiz,
      accesoDirecto: opciones.has("acceso_directo"),
      agregarPath: opciones.has("agregar_path"),
      atajosTerminal: opciones.has("atajos_terminal"),
      iniciarConSistema: opciones.has("iniciar_con_sistema"),
      versionesExactas: Object.fromEntries(versionesExactas),
    });
    estado.classList.remove("activo");
    icono.className = "icono-estado hecho";
    document.getElementById("titulo-instalando").textContent = "Instalación completa";
    document.getElementById("desc-instalando").textContent = "Ya puedes cerrar esta ventana.";
    texto.textContent = "";
    tiempoRestante.textContent = "";
    barra.style.width = "100%";
    btnSiguiente.textContent = "Finalizar";
    btnSiguiente.disabled = false;
    // `ventana.close()` (API de Tauri), no `window.close()` (API del DOM):
    // esta última solo vacía el contenido de la página en un WebView de
    // Tauri, sin cerrar la ventana del sistema operativo — se quedaba
    // completamente en blanco en vez de cerrarse.
    btnSiguiente.onclick = () => void ventana.close();
  } catch (err) {
    estado.classList.remove("activo");
    icono.className = "icono-estado error";
    tiempoRestante.textContent = "";
    const caja = document.getElementById("caja-error");
    caja.style.display = "block";
    caja.textContent = String(err);
    document.getElementById("desc-instalando").textContent = "La instalación no se completó.";
  } finally {
    cancelarEscucha();
  }
}

// Al llegar a la última pantalla, instalar arranca sola — no hace falta un
// segundo clic en un botón que además cambiaba de texto a "Instalar" justo
// al llegar, dando la sensación de que hacía falta "confirmar" dos veces.
function irA(i) {
  indice = i;
  mostrar(indice);
  if (indice === PANTALLAS.length - 1) {
    ejecutarInstalacion();
  }
}

btnSiguiente.addEventListener("click", () => {
  if (indice >= PANTALLAS.length - 1) return; // instalando o ya terminado: el clic final lo maneja `onclick` arriba
  irA(indice + 1);
});

btnAtras.addEventListener("click", () => {
  if (indice === 0) return;
  indice -= 1;
  mostrar(indice);
});

mostrar(indice);
pintarEstadoInstalados();
resolverRutaPorDefecto();
invoke("version_instalador").then((v) => {
  document.getElementById("footer-version").textContent = v;
});
