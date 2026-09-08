// Saca cada modelo a un .glb suelto, para poder importarlos en una herramienta
// de animación (Spline, Blender...). Dos motivos:
//
//   - el rack original son 459 mallas entre tornillos, cables y otras ocho
//     unidades que no salen en plano; aquí va solo la unidad que se usa.
//   - un .gltf viene partido en fichero + .bin + carpeta de texturas, y casi
//     toda herramienta prefiere que le den un único fichero.
import fs from "node:fs";
import { chromium } from "playwright";
import { levantar } from "./servidor.mjs";

const { servidor, puerto } = await levantar();
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
pagina.on("pageerror", (e) => console.error("[error]", e.message));

await pagina.goto(`http://127.0.0.1:${puerto}/exportar.html`);
await pagina.waitForFunction(() => window.listo === true, null, { timeout: 60000 });
const salidas = await pagina.evaluate(() => window.exportar());

fs.mkdirSync("glb", { recursive: true });
for (const [nombre, b64] of Object.entries(salidas)) {
  const fichero = `glb/${nombre}.glb`;
  fs.writeFileSync(fichero, Buffer.from(b64, "base64"));
  console.log(`${fichero}  ${(fs.statSync(fichero).size / 1024 / 1024).toFixed(2)} MB`);
}

await navegador.close();
servidor.close();
