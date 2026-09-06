/** Envoltorio de una línea: descarga el instalador real (Python, en
 *  /install-py) y lo ejecuta como root. No hay ningún binario compilado
 *  de por medio -- ver FUTURO.md sobre por qué se abandonó publicar un
 *  `lumi` compilado (el pipeline de release nunca lo construía, y
 *  arreglar eso significaba tocar el cruce a WSL de cada release).
 *
 *  Este script llega por un pipe (`curl … | sh`): su stdin ya es ese pipe,
 *  no la terminal de quien lo ejecuta, así que las preguntas interactivas
 *  del instalador (modo, clave maestra, almacenamiento) se encontrarían con
 *  un stdin agotado. Se reengancha a /dev/tty justo antes de lanzarlo, y
 *  solo si hay terminal de verdad delante -- si no la hay (un CI, por
 *  ejemplo), se imprime el paso siguiente en vez de colgarse. */
function script(base: string) {
  return `#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "Hace falta python3 en este sistema para instalar Lumi." >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Descargando el instalador…"
curl -fsSL "${base}/install-py" -o "$TMP"

# "$@" pasa tal cual al instalador -- para un one-liner sin preguntas usa:
#   curl -fsSL .../install | sh -s -- --version latest -y
if [ -t 1 ] && [ -r /dev/tty ]; then
  sudo python3 "$TMP" "$@" < /dev/tty
else
  echo "No hay terminal delante (¿esto corre en un script o un CI?), así que no se"
  echo "lanza el asistente interactivo. Para instalar el servidor:"
  echo "  curl -fsSL ${base}/install-py -o install.py"
  echo "  sudo python3 install.py --version latest -y"
fi
`;
}

export async function GET(request: Request) {
  // Se calcula del propio request en vez de dejarlo fijo: así el script
  // sigue funcionando igual si el dominio cambia algún día, sin tener que
  // recordar venir a actualizar esta ruta a mano.
  const base = new URL(request.url).origin;
  return new Response(script(base), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
