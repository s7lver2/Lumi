const REPO = "s7lver2/Lumi";

/** Script de instalación del CLI `lumi` — y del propio daemon, en el mismo
 *  comando. Se sirve como texto plano para que `curl … | sh` funcione.
 *
 *  El asistente de `lumi install` es interactivo (modo nativo/WSL, clave
 *  maestra, dónde guardar los datos), pero este script LLEGA por un pipe:
 *  su stdin ya es ese pipe, no la terminal de quien lo ejecuta, así que
 *  cualquier `read` del asistente encontraría el pipe agotado, no una
 *  respuesta de verdad. El arreglo es el mismo que usan otros instaladores
 *  de una línea (rustup, por ejemplo): reenganchar stdin a `/dev/tty` justo
 *  antes de lanzar el asistente, y solo si de verdad hay una terminal
 *  delante — si no la hay (un CI, por ejemplo), se imprime el paso
 *  siguiente en vez de colgarse esperando una respuesta que nunca llega. */
const SCRIPT = `#!/bin/sh
set -eu

REPO="${REPO}"
DESTINO="\${DESTINO:-/usr/local/bin}"

echo "Descargando el CLI de Lumi…"
URL="https://github.com/\${REPO}/releases/latest/download/lumi"
TMP="$(mktemp)"
curl -fsSL "\$URL" -o "\$TMP"
chmod +x "\$TMP"

if [ -w "\$DESTINO" ]; then
  mv "\$TMP" "\$DESTINO/lumi"
else
  echo "Hace falta sudo para escribir en \$DESTINO"
  sudo mv "\$TMP" "\$DESTINO/lumi"
fi

echo "Listo: \$(\$DESTINO/lumi --version)"
echo

# "\$@" pasa tal cual a "lumi install" — para un one-liner sin preguntas usa:
#   curl -fsSL .../install | sh -s -- --version latest -y
if [ -t 1 ] && [ -r /dev/tty ]; then
  echo "Arrancando el asistente de instalación…"
  echo
  "\$DESTINO/lumi" install "\$@" < /dev/tty
else
  echo "No hay terminal delante (¿esto corre en un script o un CI?), así que no se"
  echo "lanza el asistente interactivo. Para instalar el servidor:"
  echo "  sudo lumi install --version latest -y"
fi
`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
