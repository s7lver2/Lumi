/** Fondo alternativo de las pantallas de entrada (#120): olas hechas de
 *  caracteres ASCII, estático — misma paleta y misma composición (radial-
 *  gradient que se come los bordes) que `WavesBackground`, pero sin animar
 *  nada. Un patrón de texto no se puede desplazar carácter a carácter con
 *  CSS sin generar varios fotogramas de antemano, y una versión quieta ya
 *  encaja con el estilo "arte generativo" que se pedía — de paso, no hay
 *  nada que apagar para «reducir movimiento».
 *
 *  `EntryScreen` elige entre este y `WavesBackground` una vez por apertura
 *  de la app: es la variedad que se pedía, sin añadir un ajuste para algo
 *  tan menor. */

const COLS = 100;
const ROWS = 34;

// De más vacío a más denso: el mismo peso visual que una ola real, sin
// recurrir a ningún carácter fuera de lo que cualquier fuente monoespaciada
// trae de serie.
const RAMPA = [" ", " ", ".", "·", "-", "~", "=", "≈"];

function filaDeOla(fila: number): string {
  let salida = "";
  for (let c = 0; c < COLS; c++) {
    // Dos senoidales de frecuencia distinta, la segunda desfasada por fila:
    // el mismo truco que un mar de baja poli, en una dimensión menos.
    const v =
      Math.sin(c / 9 + fila * 0.5) * 0.65 +
      Math.sin(c / 4.2 - fila * 0.28) * 0.35;
    // Más silencio cerca de arriba/abajo, para que el propio texto ya se
    // "adelgace" en los bordes antes incluso del degradado que lo cubre.
    const borde = 1 - Math.abs(fila / ROWS - 0.5) * 1.7;
    const peso = Math.max(0, (v * 0.5 + 0.5) * Math.max(0, borde));
    const i = Math.min(RAMPA.length - 1, Math.floor(peso * RAMPA.length));
    salida += RAMPA[i];
  }
  return salida;
}

const FILAS = Array.from({ length: ROWS }, (_, r) => filaDeOla(r));

export function AsciiWavesBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#08090a]">
      <pre
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-pre
          font-mono text-[11px] leading-[1.15] text-[#4a4c50]"
        aria-hidden
      >
        {FILAS.join("\n")}
      </pre>
      <div className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, #050607 100%)" }} />
    </div>
  );
}
