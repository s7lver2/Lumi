# Lumi — web

Hoy solo sirve el canal de actualizaciones (`GET /api/versiones`), leído de
`releases/versiones.json`. Es la semilla del subsistema 9 (ver FUTURO.md).

## Publicar una versión nueva

No se edita `versiones.json` a mano. Se firma con la clave de quien
publica (nunca en este repo, nunca en Vercel):

    cargo run -p lumi-cli -- actualizaciones firmar releases/borrador.json releases/versiones.json

O, con los artefactos ya subidos a GitHub Releases, usando el borrador que
`tools/release.py` (en la raíz del monorepo) resuelve por ti.

## Desplegar

Proyecto Vercel apuntando a este directorio (`web/`) dentro del monorepo.
Sin variables de entorno: el manifiesto vive commiteado en el propio repo.
