# Banco de pruebas de agentes

`verdad.json` referencia, por nombre de fichero, fotos con verdad conocida que
NO viven en este repositorio (pesan, y no todas son publicables). Coloca las
fotos en un directorio aparte (p. ej. `E:\lumi-pruebas-agentes\`) y corre:

```bash
python tools/evaluar_agentes.py E:\lumi-pruebas-agentes
```

## Formato de `verdad.json`

```json
{
  "fotos": [
    {
      "fichero": "atenas-01.jpg",
      "pais": "GRC",
      "verdad": { "escritura": "griego", "lado-conduccion": "derecha" }
    }
  ]
}
```

- `fichero`: nombre exacto dentro del directorio pasado al script (no una ruta).
- `pais`: ISO3 del lugar real -- se usa para saber si la opción que ganó un
  agente de elección era la correcta según su propio mapa `paises` (spec §6:
  "acierto condicionado" es "de las veces que contesta, cuántas acierta").
- `verdad`: opcional por agente, la etiqueta correcta esperada cuando se
  conoce con certeza (más estricto que solo comprobar el país -- útil para
  `escritura`/`lado-conduccion`, donde la etiqueta correcta es inequívoca).
  Un agente sin entrada en `verdad` para esa foto se evalúa solo por país.

## Los dos números que decide

Un agente entra activo por defecto si acierto condicionado ≥ 0.70 con
cobertura ≥ 0.20 (spec 2026-09-17 §6). Si el banco dice que no llega, edita
su ficha en `registros/agentes/<id>.json` y pon `"activo": false` a mano --
el script nunca escribe en el registro.
