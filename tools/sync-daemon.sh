#!/usr/bin/env bash
# Sincroniza el daemon desde el checkout de Windows hacia este WSL,
# recompila, instala y reinicia lumid. Se corre DESDE WSL:
#
#   bash "/mnt/e/Lumi Station/tools/sync-daemon.sh"
#
# Por qué solo estas rutas y no el repo entero: este ~/Lumi es el lado del
# SERVIDOR. El cliente Tauri (Windows), la documentación y las skills de
# Claude no hacen falta aquí para nada, y en algún momento se borraron a
# propósito. Sincronizar el árbol completo las traería de vuelta cada vez
# que se corra esto. Justo por acotar tanto es como `workers/` se quedó
# fuera sin querer la primera vez — de ahí que ahora esté en la lista.
set -euo pipefail

WIN_REPO="/mnt/e/Lumi Station"
WSL_REPO="$HOME/Lumi"

if [ ! -d "$WIN_REPO" ]; then
  echo "no encuentro \"$WIN_REPO\" -- ¿la unidad E: está montada en esta WSL?" >&2
  exit 1
fi

echo "→ sincronizando crates/, workers/, Cargo.toml y Cargo.lock"
rsync -a --delete "$WIN_REPO/crates/" "$WSL_REPO/crates/"
rsync -a --delete "$WIN_REPO/workers/" "$WSL_REPO/workers/"
cp "$WIN_REPO/Cargo.toml" "$WSL_REPO/Cargo.toml"
[ -f "$WIN_REPO/Cargo.lock" ] && cp "$WIN_REPO/Cargo.lock" "$WSL_REPO/Cargo.lock"

echo "→ compilando lumid"
cd "$WSL_REPO"
cargo build -p lumid

echo "→ instalando y reiniciando el servicio"
sudo install -m755 target/debug/lumid /usr/local/bin/lumid
sudo systemctl restart lumid

echo "→ log de arranque"
sleep 1
sudo journalctl -u lumid -n 20 --no-pager
