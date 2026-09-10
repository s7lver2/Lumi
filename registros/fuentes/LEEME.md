# Fuentes del informe PDF

`crates/lumid/templates/informe.tex.tera` las carga con `fontspec` (tectonic corre XeTeX por
debajo, así que lee ficheros de fuente por ruta). A diferencia de `registros/geo/`, estos
ficheros SÍ van en el repositorio: son pequeños (~1,5 MB en total) y su licencia (OFL) permite
la redistribución, así que no hay motivo para pedirle al propietario que los baje a mano.

`routes::export::generar_pdf` los copia al directorio del job junto al `.tex`, igual que hace
con las miniaturas.

- **Inter** — 400 (`Inter-Regular.ttf`), 500 (`Inter-Medium.ttf`), 600 (`Inter-SemiBold.ttf`).
  Estáticos, no el variable: `fontspec` con pesos fijos es más simple y predecible en tectonic
  que declarar ejes de variación. Fuente: https://github.com/rsms/inter/releases (v4.1).
- **JetBrains Mono** — 400 (`JetBrainsMono-Regular.ttf`), 500 (`JetBrainsMono-Medium.ttf`).
  Fuente: https://github.com/JetBrains/JetBrainsMono/releases (v2.304).

Ambas son SIL Open Font License 1.1 -- `OFL-Inter.txt` y `OFL-JetBrainsMono.txt` al lado de
cada una, como pide la licencia.

**Degradación:** si algún fichero falta en disco (una instalación vieja que no los trajo, o
alguien los borró a mano), la plantilla cae a `lmodern` vía `\IfFileExists` y el informe se
genera igual, más feo. Un informe que no compila es peor que uno con la fuente equivocada.
