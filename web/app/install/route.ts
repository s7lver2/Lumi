const REPO = "s7lver2/Lumi";

/** Script de instalación del CLI `lumi`. Se sirve como texto plano para que
 *  `curl … | sh` funcione. No instala el daemon: eso lo hace después
 *  `sudo lumi install --version latest`, que ya existe. */
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
echo "Ahora, para instalar el servidor:"
echo "  sudo lumi install --version latest -y"
`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
