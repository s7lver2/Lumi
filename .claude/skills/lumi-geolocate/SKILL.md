---
name: lumi-geolocate
description: Use when the user shares a photo and asks where it was taken, or otherwise wants Lumi's own street-view geolocation pipeline run against an image. Requires a running local Lumi instance (default http://localhost:3000).
---

## Cómo usar esta skill

Base URL por defecto: `http://localhost:3000` (instancia local de Lumi). Si el usuario menciona otro host/puerto, úsalo en su lugar.

1. **Si la imagen es una URL**, descárgala primero a un archivo temporal:
   `curl -s -o /tmp/lumi-query.jpg "<url>"`

2. **Estimación** — sube la imagen:
   `curl -s -X POST http://localhost:3000/api/models/lumi-preview/estimate -F "image=@<ruta-local>"`
   Responde JSON `{ searchId, regions, candidatesByRegion }`. Elige la región con mayor `aggregateScore` (no asumas que es la primera del array — compara explícitamente).

3. **Refinamiento** — envía esa región:
   `curl -N -s -X POST http://localhost:3000/api/models/lumi-preview/refine -H "Content-Type: application/json" -d '{"searchId":"<searchId>","regionId":"<regionId>"}'`
   Esto es un stream SSE — puede tardar varios minutos (la verificación geométrica es ~10-25s por candidato). Antes de ejecutarlo, avisa al usuario de que puede tardar. La salida son líneas `data: {...}`; el resultado final es el evento con `"type":"done"`, que trae `result.candidates` ya repuntuados por verificación.

4. **Mostrar el resultado** — construye `http://localhost:3000/results/<searchId>` y entrégasela al usuario (como enlace, o incrustada si el cliente lo soporta) en vez de solo volcar coordenadas en crudo. Menciona también el candidato ganador (lugar aproximado, % de confianza) en texto, ya que no todo cliente puede seguir un enlace.

## Errores comunes

- **No hay respuesta en `http://localhost:3000`**: Lumi no está corriendo. Dile al usuario que arranque la app (`python3 tools/build.py` en desarrollo, o el ejecutable instalado) y reintenta.
- **`estimate` devuelve `404`/`409`**: el modelo indicado no existe o no es el activo ahora mismo — vuelve a consultar `GET /api/models` para ver cuál es el modelo activo real y usa ese id.
- **`regions` vacío**: no se encontró ninguna coincidencia. Dile esto directamente al usuario, no inventes un resultado.
- **El evento SSE final es `{"type":"error", ...}`**: el refinamiento falló (servicio de inferencia caído, etc.) — muestra `message` al usuario, no reintentes en bucle automáticamente.
