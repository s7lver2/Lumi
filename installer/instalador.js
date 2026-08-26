// Import ES real, no `window.__TAURI__` — ese global solo existe si
// `app.withGlobalTauri` está a `true` en tauri.conf.json, y la plantilla
// clonada de `indexer/` no lo tiene así. `@tauri-apps/api` ya es
// dependencia (viene del `package.json` clonado).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

const PANTALLAS = ["p_bienvenida", "p_productos", "p_ubicacion", "p_instalando"];
let indice = 0;
let raiz = "%LocalAppData%\\Programs\\Lumi";
const seleccion = new Set(["cliente", "indexer"]);

const btnAtras = document.getElementById("btn-atras");
const btnSiguiente = document.getElementById("btn-siguiente");

function mostrar(i) {
  PANTALLAS.forEach((id, n) => {
    document.getElementById(id).classList.toggle("active", n === i);
  });
  btnAtras.style.visibility = i === 0 ? "hidden" : "visible";
  btnSiguiente.textContent = i === PANTALLAS.length - 1 ? "Instalar" : "Siguiente";
}

document.querySelectorAll(".option-row[data-producto]").forEach((fila) => {
  fila.addEventListener("click", () => {
    const producto = fila.dataset.producto;
    const casilla = fila.querySelector(".checkbox");
    if (seleccion.has(producto)) {
      seleccion.delete(producto);
      casilla.classList.remove("checked");
    } else {
      seleccion.add(producto);
      casilla.classList.add("checked");
    }
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
      const fila = document.querySelector(`.option-row[data-producto="${item.producto}"]`);
      fila.querySelector(".checkbox").classList.remove("checked");
      seleccion.delete(item.producto);
    }
  }
}

async function ejecutarInstalacion() {
  document.getElementById("btn-siguiente").disabled = true;
  document.getElementById("btn-atras").style.visibility = "hidden";

  const productos = [...seleccion];
  const cancelarEscucha = await listen("progreso", (evento) => {
    const { producto, fase } = evento.payload;
    document.getElementById("estado-texto").textContent = `${producto}: ${fase}`;
  });

  try {
    await invoke("instalar", { productos, raiz });
    document.getElementById("titulo-instalando").textContent = "Instalación completa";
    document.getElementById("desc-instalando").textContent = "Ya puedes cerrar esta ventana.";
    document.getElementById("barra").style.width = "100%";
    btnSiguiente.textContent = "Finalizar";
    btnSiguiente.disabled = false;
    btnSiguiente.onclick = () => window.close();
  } catch (err) {
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
