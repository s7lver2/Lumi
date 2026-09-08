// Captura la secuencia: abre la escena en un Chromium headless, la coloca en
// cada instante de la línea de tiempo y guarda un fotograma por instante.
//
//   node capturar.mjs                      -> secuencia completa a fotogramas/
//   node capturar.mjs --previa             -> solo 6 fotogramas, para mirar
//   node capturar.mjs --t 0.5              -> un instante suelto
//
// El tiempo lo manda este script, no un bucle de animación en la página: el
// fotograma N sale idéntico corrida tras corrida, que es lo que permite
// iterar sobre la escena comparando.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { levantar } from "./servidor.mjs";

const args = process.argv.slice(2);
const tiene = (n) => args.includes(n);
const valor = (n, pd) => (args.includes(n) ? args[args.indexOf(n) + 1] : pd);

const ANCHO = +valor("--ancho", 1280);
const ALTO = +valor("--alto", 720);
const SALIDA = valor("--salida", tiene("--previa") ? "previa" : "fotogramas");
const N = +valor("--n", 120);

let instantes;
if (tiene("--t")) instantes = [+valor("--t", 0.5)];
else if (tiene("--previa")) instantes = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1];
else instantes = Array.from({ length: N }, (_, i) => i / (N - 1));

fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(SALIDA, { recursive: true });

const { servidor, puerto } = await levantar();
const navegador = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const pagina = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO } });
pagina.on("console", (m) => console.log("[navegador]", m.text()));
pagina.on("pageerror", (e) => console.error("[error]", e.message));

await pagina.goto(`http://127.0.0.1:${puerto}/escena.html?w=${ANCHO}&h=${ALTO}`);
await pagina.waitForFunction(() => window.listo === true, null, { timeout: 120000 });

for (const [i, t] of instantes.entries()) {
  const datos = await pagina.evaluate((t) => {
    window.pintar(t);
    return document.querySelector("canvas").toDataURL("image/png");
  }, t);
  const nombre = tiene("--t")
    ? `t${String(t).replace(".", "_")}.png`
    : `${String(i).padStart(4, "0")}.png`;
  fs.writeFileSync(path.join(SALIDA, nombre), Buffer.from(datos.split(",")[1], "base64"));
  if (i % 10 === 0 || i === instantes.length - 1) {
    console.log(`  ${i + 1}/${instantes.length}  t=${t.toFixed(3)}`);
  }
}

console.log(`listo: ${instantes.length} fotogramas en ${SALIDA}/`);
await navegador.close();
servidor.close();
