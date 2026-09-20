# Datos geográficos

Tres ficheros. `lado.json` y `orto-wms.json` vienen en el repositorio; `paises.json` lo pone el
propietario, porque pesa y porque su licencia obliga a atribuir la fuente donde el usuario la vea.

**Sin estos ficheros el daemon arranca igual.** Cada resolutor que se quede sin datos devuelve
«no lo sé» — sin `paises.json`, por ejemplo, el informe PDF simplemente no dice el país de cada
hipótesis, en vez de inventar uno. Es la misma postura que el `sha256` vacío del registro de
modelos.

## `paises.json`

Fronteras terrestres, para saber en qué país cae una coordenada candidata.

- **Fuente:** Natural Earth, *Admin 0 – Countries*, escala 1:110m. Dominio público.
- **Formato:** `{"paises": [{"iso": "ESP", "anillos": [[[lng, lat], ...]]}]}`. `iso` es ISO-3166
  alfa-3 (el campo `ADM0_A3` del dataset). Cada anillo es el contorno exterior de un polígono, en
  el orden `(lng, lat)` de GeoJSON. Los agujeros no se modelan.

## `orto-wms.json`

Tabla de servicios WMS de ortofoto nacional, para el origen `wms-orto` del Indexer
(`indexer/src-tauri/src/origins/wms_orto.rs`). Es dato, no código: qué servicio cubre qué
territorio no debería obligar a recompilar nada. **Opcional** — sin este fichero (o con uno
corrupto), el origen degrada a "no hay" en cualquier tesela en vez de fallar.

- **Fuente:** uno por país/organismo, añadido a mano según se van verificando. Hoy solo trae
  PNOA (IGN, España).
- **Formato:** `{"servicios": [{"id", "nombre", "url", "capa", "formato", "crs", "version",
  "licencia", "atribucion", "cobertura": [[oeste, sur], [este, norte]]}]}`. `licencia` y
  `atribucion` se rellenan a mano por servicio, igual que `fichero_url`/`licencia`/`sha256` en el
  registro de modelos — no hay forma automática de verificar la licencia real de un WMS de
  terceros.
