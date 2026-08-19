# Pulido visual de MapRow — diseño

## Contexto

`client/src/admin/MapRow.tsx` (la elección de tema de mapa y motor de
dibujo, dentro de Customización) sigue marcado con un comentario
"PROVISIONAL. El subsistema 3 rehace el panel entero" heredado de cuando
todo el panel era un esqueleto. Es incorrecto hoy: el componente funciona
bien, con vista previa en vivo por tema (`MapThemePreview.tsx` monta un
mapa MapLibre real, no una imagen estática) y avisos claros de clave
faltante y del compromiso de seguridad de cada motor.

Al revisar qué queda pendiente del subsistema 3b, se confirmó con el
usuario que esto no necesita funcionalidad nueva — ni más ajustes de mapa,
ni una vista previa a tamaño completo — solo alinear su acabado visual con
el resto del panel ya pulido (Resumen, Cola).

## Alcance

Solo `client/src/admin/MapRow.tsx`. Sin cambios de datos, sin endpoints
nuevos, sin tocar `MapThemePreview.tsx` ni `CustomizacionView.tsx`.

1. **Quitar el comentario "PROVISIONAL"** — ya no describe el estado real
   del componente.
2. **Entrada escalonada de las tarjetas de tema**: cada tarjeta anima con
   `jg-fade-rise` (la misma curva ya usada en el resto del panel) con un
   pequeño retraso creciente por índice, en vez de aparecer todas de golpe.
3. **Tarjeta seleccionada más presente**: además del cambio de color de
   borde que ya tiene, un anillo/sombra sutil (`ring` o `shadow` con el
   token de acento existente) para que se lea de un vistazo cuál está
   activo, no solo al fijarse en el icono de check pequeño.
4. **Espaciado del bloque "Quién dibuja"**: alinear su tipografía/espaciado
   con el grid de temas de arriba — hoy se siente más apretado en
   comparación.

## Fuera de alcance

- Vista previa a tamaño completo del mapa configurado.
- Ajustes de mapa nuevos (centro/zoom por defecto, etc.).
- Cualquier cambio en `MapThemePreview.tsx`, `CustomizacionView.tsx`, o el
  backend (`routes/map.rs`).
