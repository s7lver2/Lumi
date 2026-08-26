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
let raiz = "%LocalAppData%\\Programs\\Lumi";
const seleccion = new Set(["cliente", "indexer"]);
const opciones = new Set(["acceso_directo"]);

const btnAtras = document.getElementById("btn-atras");
const btnSiguiente = document.getElementById("btn-siguiente");

function mostrar(i) {
  PANTALLAS.forEach((id, n) => {
    document.getElementById(id).classList.toggle("active", n === i);
  });
  btnAtras.style.visibility = i === 0 ? "hidden" : "visible";
  btnSiguiente.textContent = i === PANTALLAS.length - 1 ? "Instalar" : "Siguiente";
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
    if (tarjeta.classList.contains("instalado")) return;
    const producto = tarjeta.dataset.producto;
    const casilla = tarjeta.querySelector(".checkbox");
    if (seleccion.has(producto)) {
      seleccion.delete(producto);
      casilla.classList.remove("checked");
    } else {
      seleccion.add(producto);
      casilla.classList.add("checked");
    }
  });
});

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
      sub.textContent = `Ya instalado (${item.version})`;
      const tarjeta = document.querySelector(`.product-card[data-producto="${item.producto}"]`);
      tarjeta.classList.add("instalado");
      tarjeta.querySelector(".checkbox").classList.remove("checked");
      seleccion.delete(item.producto);
    }
  }
}

const PORCENTAJE_POR_FASE = { descargando: 33, verificando: 66, copiando: 90 };

async function ejecutarInstalacion() {
  document.getElementById("btn-siguiente").disabled = true;
  document.getElementById("btn-atras").style.visibility = "hidden";

  const estado = document.getElementById("estado-texto");
  const texto = estado.querySelector(".texto");
  const barra = document.getElementById("barra");
  const icono = document.getElementById("icono-estado");
  estado.classList.add("activo");
  icono.className = "icono-estado en-curso";

  const productos = [...seleccion];
  const cancelarEscucha = await listen("progreso", (evento) => {
    const { producto, fase } = evento.payload;
    texto.textContent = `${producto}: ${fase}`;
    barra.style.width = `${PORCENTAJE_POR_FASE[fase] ?? 0}%`;
  });

  try {
    await invoke("instalar", {
      productos,
      raiz,
      accesoDirecto: opciones.has("acceso_directo"),
      agregarPath: opciones.has("agregar_path"),
      atajosTerminal: opciones.has("atajos_terminal"),
      iniciarConSistema: opciones.has("iniciar_con_sistema"),
    });
    estado.classList.remove("activo");
    icono.className = "icono-estado hecho";
    document.getElementById("titulo-instalando").textContent = "Instalación completa";
    document.getElementById("desc-instalando").textContent = "Ya puedes cerrar esta ventana.";
    texto.textContent = "";
    barra.style.width = "100%";
    btnSiguiente.textContent = "Finalizar";
    btnSiguiente.disabled = false;
    btnSiguiente.onclick = () => window.close();
  } catch (err) {
    estado.classList.remove("activo");
    icono.className = "icono-estado error";
    const caja = document.getElementById("caja-error");
    caja.style.display = "block";
    caja.textContent = String(err);
    document.getElementById("desc-instalando").textContent = "La instalación no se completó.";
  } finally {
    cancelarEscucha();
  }
}

btnSiguiente.addEventListener("click", () => {
  if (indice === PANTALLAS.length - 1) {
    ejecutarInstalacion();
    return;
  }
  indice += 1;
  mostrar(indice);
});

btnAtras.addEventListener("click", () => {
  if (indice === 0) return;
  indice -= 1;
  mostrar(indice);
});

mostrar(indice);
pintarEstadoInstalados();
