// Junta los fotogramas de una carpeta en una sola tira de contactos.
// Mirar el arco entero de un vistazo cuesta una imagen en vez de siete, y
// además los saltos entre fotogramas se ven mucho mejor comparados de lado.
//
//   node tira.mjs [carpeta] [columnas]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const carpeta = process.argv[2] ?? "previa";
const columnas = +(process.argv[3] ?? 4);
const ANCHO = 440; // por celda

const ficheros = fs
  .readdirSync(carpeta)
  .filter((f) => f.endsWith(".png"))
  .sort();
if (ficheros.length === 0) throw new Error(`no hay fotogramas en ${carpeta}/`);

const primera = await sharp(path.join(carpeta, ficheros[0])).metadata();
const alto = Math.round((ANCHO * primera.height) / primera.width);
const filas = Math.ceil(ficheros.length / columnas);

const celdas = await Promise.all(
  ficheros.map(async (f, i) => ({
    input: await sharp(path.join(carpeta, f)).resize(ANCHO, alto).png().toBuffer(),
    left: (i % columnas) * ANCHO,
    top: Math.floor(i / columnas) * alto,
  })),
);

const salida = `${carpeta}-tira.png`;
await sharp({
  create: {
    width: ANCHO * columnas,
    height: alto * filas,
    channels: 3,
    background: { r: 5, g: 6, b: 7 },
  },
})
  .composite(celdas)
  .png()
  .toFile(salida);

console.log(`${salida}  (${ficheros.length} fotogramas, ${columnas}x${filas})`);
