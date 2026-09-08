// Copia un modelo reduciendo sus texturas, para poder exportarlo a un .glb de
// tamaño manejable.
//
// El brazo trae texturas de 2048² en PNG sin comprimir: al empotrarlas dentro
// de un .glb salen 122 MB, que no hay herramienta que quiera importar. A 1024²
// y en JPEG (menos el mapa de normales, que sí necesita ser PNG porque un
// artefacto de compresión en un mapa de normales se ve como una abolladura)
// baja a un orden de magnitud razonable sin perder el relieve, que es lo único
// que de verdad se aprovecha: el color se rehace en la paleta de Lumi.
//
//   node aligerar.mjs robotic_prosthetic_arm [lado]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const modelo = process.argv[2];
const LADO = +(process.argv[3] ?? 1024);
if (!modelo) throw new Error("uso: node aligerar.mjs <carpeta-del-modelo> [lado]");

const origen = path.join("modelos", modelo);
const destino = path.join("modelos-ligeros", modelo);
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(path.join(destino, "textures"), { recursive: true });

for (const f of ["scene.gltf", "scene.bin", "license.txt"]) {
  if (fs.existsSync(path.join(origen, f))) {
    fs.copyFileSync(path.join(origen, f), path.join(destino, f));
  }
}

let antes = 0;
let despues = 0;
for (const nombre of fs.readdirSync(path.join(origen, "textures"))) {
  const entrada = path.join(origen, "textures", nombre);
  const salida = path.join(destino, "textures", nombre);
  antes += fs.statSync(entrada).size;

  const esNormal = /normal/i.test(nombre);
  const img = sharp(entrada).resize(LADO, LADO, { fit: "inside", withoutEnlargement: true });
  // Se conserva la extensión aunque por dentro sea JPEG: el .gltf referencia
  // los ficheros por nombre y reescribirlo para cambiar tres extensiones sería
  // más frágil que dejar un .png que en realidad lleva JPEG dentro, algo que
  // todo cargador acepta porque mira los bytes, no el nombre.
  await (esNormal ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 86 })).toFile(salida);
  despues += fs.statSync(salida).size;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`${destino}: texturas ${mb(antes)} MB -> ${mb(despues)} MB`);
