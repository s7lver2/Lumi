# Datos geográficos

Tres ficheros. `lado.json` viene en el repositorio; los otros dos los pone el propietario, porque
pesan y porque su licencia obliga a atribuir la fuente donde el usuario la vea.

**Sin estos ficheros el daemon arranca igual.** Cada resolutor que se quede sin datos devuelve
«no lo sé», y un agente cuyo resolutor no sabe nada se abstiene: no repondera, no descarta, y en
el informe aparece diciendo que no tuvo señal suficiente. Es la misma postura que el `sha256`
vacío del registro de modelos.

## `paises.json`

Fronteras terrestres, para saber en qué país cae una coordenada candidata.

- **Fuente:** Natural Earth, *Admin 0 – Countries*, escala 1:110m. Dominio público.
- **Formato:** `{"paises": [{"iso": "ESP", "anillos": [[[lng, lat], ...]]}]}`. `iso` es ISO-3166
  alfa-3 (el campo `ADM0_A3` del dataset). Cada anillo es el contorno exterior de un polígono, en
  el orden `(lng, lat)` de GeoJSON. Los agujeros no se modelan.

## `koppen.bin`

Clima, para saber si un candidato cae en zona tropical, árida, templada, continental o polar.

- **Fuente:** Beck et al. 2018, *Present and future Köppen-Geiger climate classification maps*,
  resolución 0,5°. CC BY 4.0 — la atribución va en la sección de modelos de la web.
- **Formato:** 720 × 360 = 259 200 bytes, un byte por celda, filas de norte (90°) a sur (−90°) y
  columnas de oeste (−180°) a este (180°). El byte es la **letra del grupo** en ASCII: `A`, `B`,
  `C`, `D` o `E`. `0` significa «sin dato», que es lo que va en el océano. Un fichero de cualquier
  otro tamaño se descarta entero: leerlo torcido pondría el Sáhara en Laponia.
