# `tools/build.py release` interactivo — diseño

## Contexto

Publicar una versión hoy es un proceso manual en varios sitios desconectados entre sí (ver la
conversación que motivó esta spec): la versión vive en 7 archivos distintos sin relación entre
ellos (`Cargo.toml` del workspace + `Cargo.toml`/`tauri.conf.json` de cliente, Indexer e
installer), `lumid` se compila aparte en WSL porque es Linux-only, subir los binarios a GitHub
Releases es manual, y armar el `borrador.json` que consume `tools/release.py` es a mano —
incluyendo acordarse de copiar el histórico de publicaciones ya existente, sin lo cual un
downgrade (spec [2026-08-26-compatibilidad-de-version-design.md](2026-08-26-compatibilidad-de-version-design.md))
deja de tener nada que ofrecer en cuanto se publica una versión nueva encima.

Esta spec añade `python tools/build.py release`: un flujo interactivo que hace todo el proceso de
principio a fin, desde preguntar la versión hasta comitear el manifiesto firmado, con una sola
pausa de confirmación real (antes de comitear/pushear) porque el resto ya lo aprobó quien lo
lanza al elegir qué publicar. Usa `tsuki-ux` (paquete propio en PyPI, `pip install tsuki-ux`,
se importa como `tsuki_ux`) para toda la salida — es la librería de terminal que ya usan otros
proyectos propios, y da de fábrica lo que este comando necesita: `step`/`success`/`fail`/`warn`
para cada fase, `LiveBlock`/`run()` para envolver subprocesos largos (compilar, `gh`), `Spinner`
para esperas cortas, y `config_table`/`ConfigEntry` para la tabla resumen.

## Alcance

- Nuevo target `release` en `tools/build.py`, interactivo, usando `tsuki_ux` para toda la salida
  (tabla resumen, pasos, confirmaciones).
- Antes de preguntar nada, muestra una tabla con la última versión publicada de cada producto
  (leída del `web/releases/versiones.json` ya comiteado): versión, fecha, si está retirada.
- Escribe una única versión en los 7 sitios donde vive hoy desconectada.
- Construye cliente/Indexer/installer en Windows; compila `lumid` en WSL (`~/Lumi`, sincronizado
  con `git pull` contra este mismo repo como remoto local) si se elige publicarlo.
- Sube los binarios elegidos + `installer.exe` a GitHub Releases (`s7lver2/Lumi`) vía `gh`.
- Arma el borrador conservando el histórico ya publicado, reusa `tools/release.py` tal cual
  existe para calcular hashes y firmar.
- Confirma antes de comitear/pushear `web/releases/versiones.json` y los bumps de versión.

Fuera de alcance (con motivo):

- **Rotación de la clave de firma**: sigue siendo un techo anotado aparte
  (`crates/lumi-proto/src/actualizacion.rs`), este comando no la toca.
- **`package.json` de cliente/Indexer/installer**: ya se confirmó en la investigación previa que
  esos números (`0.0.0`) no se leen en ningún sitio funcional — no hace falta escribirlos.
- **Borradores parciales/reanudables**: si el comando falla a medias (por ejemplo, `gh release
  create` falla tras haber compilado), se relanza desde el principio — no hay checkpoint. Los
  pasos son en su mayoría deterministas y baratos de repetir (compilar de nuevo no es gratis,
  pero es el mismo camino que ya existe hoy a mano); un mecanismo de reanudar se añade el día que
  el coste real de recompilar lo justifique, no antes.
- **Modo no interactivo/CI**: es explícitamente interactivo por diseño de esta spec; una variante
  con flags para CI es un comando distinto si algún día hace falta.
- **`traceback_box`/`box` de `tsuki_ux`**: no hace falta un formato de error tan elaborado aquí;
  los errores de este comando se comunican con `fail()`, que ya es consistente con el resto.

---

## 0. Dependencia nueva

`tools/requirements.txt` (nuevo archivo, no existía ninguno):

```
tsuki-ux>=1.0.11
```

`tools/build.py` comprueba `import tsuki_ux` al entrar al target `release` (no en los demás
targets, que no lo necesitan) y, si falta, para con un mensaje claro:
`"falta tsuki-ux: pip install -r tools/requirements.txt"` — mismo criterio que el resto del
proyecto de fallar explícito en vez de degradar en silencio.

## 1. Los 7 sitios de versión

| Archivo | Campo |
|---|---|
| `Cargo.toml` (raíz) | `[workspace.package] version` |
| `client/src-tauri/Cargo.toml` | `[package] version` |
| `client/src-tauri/tauri.conf.json` | `"version"` |
| `indexer/src-tauri/Cargo.toml` | `[package] version` |
| `indexer/src-tauri/tauri.conf.json` | `"version"` |
| `installer/src-tauri/Cargo.toml` | `[package] version` |
| `installer/src-tauri/tauri.conf.json` | `"version"` |

El comando escribe la misma versión en los 7, siempre, sin importar qué productos se publiquen
en esta tanda concreta — es la forma de que dejen de estar desconectados a partir de ahora.

## 2. Flujo interactivo

1. **Comprobaciones previas**: `gh auth status` (si falla, aborta con `fail()` y el mensaje de
   `gh` tal cual — no hay nada más específico que añadir); `git status --short` del repo de
   Windows debe estar limpio (si no, aborta con `fail()` y lista qué hay sin comitear — publicar
   desde un árbol sucio arriesga que el binario no coincida con lo que se comitea al final).
2. **Tabla resumen**: lee `web/releases/versiones.json`, agrupa `publicaciones` por `producto` y
   se queda con la más reciente de cada uno (por `publicado`), y la pinta con `config_table`:

   ```python
   from tsuki_ux import config_table, ConfigEntry
   config_table("última versión publicada", [
       ConfigEntry("cliente", "2.0.4", comment="2026-08-20 · retirada" if retirada else "2026-08-20"),
       ConfigEntry("indexer", "2.0.4", comment="2026-08-20"),
       ConfigEntry("lumid",   "sin publicar", comment=""),
   ])
   ```

   Un producto sin ninguna publicación todavía se muestra como `"sin publicar"`, no se omite la
   fila — así la tabla siempre tiene las tres filas, sea la primera vez o la enésima.
4. **Qué publicar**: pregunta cliente/Indexer/lumid, `s/n` cada uno, `s` por defecto (Enter =
   sí). Si ninguno se marca, aborta — no tiene sentido un release vacío.
5. **Versión**: pide un `x.y.z`, valida con una expresión simple (tres enteros separados por
   puntos) — mismo criterio de parseo que `lumi-proto::actualizacion::partes`, sin sufijos de
   pre-release, por consistencia con lo que el propio canal ya asume.
6. **Notas**: una línea de texto libre, compartida por todas las publicaciones de esta tanda.
7. **Resumen y confirmación**: `config_table` con lo elegido (productos, versión, notas) y pide
   confirmar antes de tocar nada — barata de mostrar, evita un `Ctrl-C` a mitad de compilación
   por un número mal tecleado.
8. **Escribir versión**: los 7 archivos de la sección 1. Un `step()`/`success()` por archivo.
9. **Construir**, cada compilación envuelta en `LiveBlock`/`run()` de `tsuki_ux` (así se ve línea
   a línea mientras corre, y se pliega a un resumen de una línea al terminar):
   - Cliente elegido → `run(["npm", "run", "tauri", "build"], cwd="client")` (ya hace
     `cargo build --release` como parte de su propio proceso, vía `tauri-build`).
   - Indexer elegido → lo mismo en `indexer/`.
   - Instalador → siempre, lo mismo en `installer/` (se publica en cada release, ver sección 4).
   - `lumid` elegido → un `Spinner("Compilando lumid en WSL…")` mientras corre
     `wsl.exe -- bash -lc 'cd ~/Lumi && git pull && cargo build --release -p lumid'` (esto no
     pasa por `run()` de `tsuki_ux`, que es para subprocesos locales — `wsl.exe` ya tiene su
     propio streaming); si `git pull` falla (conflicto, cambios sin comitear en `~/Lumi`) el
     `Spinner` termina con `ok=False` y se aborta mostrando la salida de git tal cual — no
     intenta resolver nada por su cuenta. El binario resultante (`~/Lumi/target/release/lumid`)
     se copia a una carpeta temporal dentro de este repo (`.release-tmp/lumid`, en `.gitignore`)
     para que el resto del proceso, que corre en Windows, pueda leerlo por ruta normal.
10. **Localizar artefactos**: rutas fijas, mismas que ya asume `installer/src-tauri/src/comandos.rs`
   y `silencioso.rs` (`nombre_ejecutable`): `client/src-tauri/target/release/app.exe`,
   `indexer/src-tauri/target/release/indexer-app.exe`, `installer/src-tauri/target/release/installer.exe`,
   `.release-tmp/lumid`.
11. **Subir a GitHub Releases**, envuelto en `LiveBlock`/`run()`: `gh release create v<version>
    <artefactos-elegidos> installer.exe --repo s7lver2/Lumi --title v<version> --notes <notas>`.
    La URL de descarga de cada asset es predecible
    (`https://github.com/s7lver2/Lumi/releases/download/v<version>/<archivo>`), no hace falta
    parsear la salida de `gh` para construirla.
12. **Armar el borrador conservando el histórico**: lee el `web/releases/versiones.json` YA
    comiteado, toma su `publicaciones` tal cual (sin `firma`/`clave_publica`, que
    `tools/release.py`/`lumi actualizaciones firmar` recalculan), y le añade una entrada nueva
    por cada producto elegido (`producto`, `version`, `publicado` = ahora en ISO 8601, `notas`,
    `retirada: false`, `artefactos: [{ plataforma, archivo: <ruta local>, url: <url de GitHub>
    }]`). El resultado se escribe en `.release-tmp/borrador.json`.
13. **Firmar**: `run(["python", "tools/release.py", ".release-tmp/borrador.json"])` — sin
    duplicar la lógica de hash/firma que ya existe ahí, solo se reusa.
14. **Confirmación final**: `config_table` con el diff de `git status --short` (los 7 archivos de
    versión + `web/releases/versiones.json`) y pregunta `¿comitear y pushear? [s/N]`. Si sí:
    `git add` de esos archivos, commit `chore: publicar versión <x.y.z>`, `git push`, cada paso
    con su `step()`/`success()`. Si no: `warn()` explicando que queda todo en el árbol de trabajo
    sin comitear — el release de GitHub ya se publicó (paso 11), pero el manifiesto firmado sigue
    solo en el disco local hasta que alguien lo comitee/pushee a mano.

## 3. Errores y casos límite

| Situación | Comportamiento |
|---|---|
| `gh` sin sesión iniciada | Aborta antes de tocar nada, con el mensaje de `gh auth status` |
| Árbol de Windows sucio | Aborta antes de tocar nada, lista `git status --short` |
| `git pull` falla en `~/Lumi` (WSL) | Aborta mostrando la salida de git; no se sube nada a GitHub si `lumid` era el único producto elegido |
| Ningún producto elegido | Aborta antes de preguntar versión/notas |
| `gh release create` falla (tag ya existe, sin red) | Aborta con el error de `gh`; nada se comitea (el borrador y la firma son posteriores a este paso) |
| Usuario dice "no" a la confirmación final | El release de GitHub queda publicado, pero `versiones.json`/los bumps de versión quedan sin comitear — se puede revisar y comitear a mano después |

## 4. Qué reemplaza / con qué convive

Reemplaza el proceso manual descrito en la conversación previa (editar versiones a mano, subir
binarios a mano, escribir `borrador.json` a mano). Convive sin cambios con `tools/release.py`
(lo sigue usando tal cual, como paso final de firma) y con el resto de `tools/build.py`
(`dev`/`indexer`/`build`/`installer` no cambian).
