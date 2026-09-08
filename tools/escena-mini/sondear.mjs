// Sonda: abre los tres modelos en un Chromium headless y vuelca lo que hace
// falta para componer la escena (escalas, huesos de los dedos, qué malla es
// una unidad de rack). Se corre a mano, no forma parte de la captura.
import fs from "node:fs";
import { chromium } from "playwright";
import { levantar } from "./servidor.mjs";

const { servidor, puerto } = await levantar();
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
pagina.on("console", (m) => console.log("[navegador]", m.text()));
pagina.on("pageerror", (e) => console.error("[error]", e.message));

await pagina.goto(`http://127.0.0.1:${puerto}/sondear.html`);
await pagina.waitForFunction(() => typeof window.sondear === "function");
const datos = await pagina.evaluate(() => window.sondear());

fs.writeFileSync("sonda.json", JSON.stringify(datos, null, 2));
console.log(JSON.stringify(datos.apple_mac_mini_m1, null, 2));
console.log("huesos:", datos.robotic_prosthetic_arm.huesos.length);
console.log("mallas del rack:", datos.server_racking_system.totalMallas);

await navegador.close();
servidor.close();
