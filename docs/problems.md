# Problemas de setup en Windows — pnpm / PostgreSQL / migraciones

Registro de los problemas encontrados al levantar el entorno local (Windows) para correr `createdb` + las migraciones de `db/` con `pnpm test`, y cómo se resolvió cada uno.

---

## 1. `createdb` / `pnpm` no reconocidos como comando

**Contexto:** `pnpm` es el gestor de paquetes usado en el monorepo. Ahorra espacio en disco frente a npm/yarn usando un almacén global + symlinks, evita el *phantom hoisting*, y tiene soporte nativo de workspaces para monorepos.

Instalación (vía npm):
```bash
npm install -g pnpm
```

Comandos esenciales:
- `pnpm install` — instala dependencias de `package.json`.
- `pnpm add <paquete>` — instala y añade una dependencia.
- `pnpm remove <paquete>` — elimina un paquete.
- `pnpm update` — actualiza dependencias.
- `pnpm <script>` — ejecuta un script de `package.json` (ej. `pnpm dev`).

Referencia: [Guía de instalación oficial de pnpm](https://pnpm.io/installation)

---

## 2. `createdb` no reconocido en Windows ("no existe el comando")

**Causa:** el instalador de PostgreSQL en Windows no añade automáticamente `bin/` al `PATH` del sistema.

**Solución:**
1. Localizar la carpeta `bin` de la instalación, típicamente:
   ```
   C:\Program Files\PostgreSQL\<VERSION>\bin
   ```
2. Windows → buscar "variables de entorno" → **Editar las variables de entorno del sistema** → **Variables de entorno...**
3. En **Variables del sistema** → `Path` → **Nuevo** → pegar la ruta anterior.
4. Aceptar en las tres ventanas y **reiniciar la terminal** (obligatorio; una terminal ya abierta no detecta el cambio).
5. Probar:
   ```bash
   createdb -U postgres mi_base_datos
   ```

**Alternativa sin tocar el PATH:** usar **pgAdmin** (se instala junto con Postgres) → clic derecho en "Databases" → *Create* → *Database...*

---

## 3. Error de autenticación: `la autentificación password falló para el usuario «NICKE»`

**Causa:** en Windows, `createdb` sin `-U` intenta conectar con el usuario del sistema operativo (en este caso `NICKE`) en vez del usuario administrador de Postgres (`postgres`).

**Solución:** especificar explícitamente el usuario administrador:
```powershell
createdb -U postgres netryx_test
```

Se pide la contraseña que se definió para el usuario `postgres` durante la instalación.

---

## 4. `&&` y variables de entorno estilo Linux no funcionan en PowerShell

**Síntoma:**
```
TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test: The term '...' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

**Causa:** la sintaxis `VAR=valor comando` (estilo bash/Linux) y el encadenado `&&` no se comportan igual en PowerShell.

**Solución rápida en PowerShell** (sin tocar el proyecto):
```powershell
createdb -U postgres netryx_test; if ($?) { cd db; pnpm install; $env:TEST_DATABASE_URL="postgres://postgres:TU_CONTRASEÑA@localhost:5432/netryx_test"; pnpm test }
```
- `; if ($?) { ... }` reemplaza a `&&` (ejecuta el siguiente bloque solo si el anterior tuvo éxito).
- `$env:VARIABLE="valor"` reemplaza a `VARIABLE=valor` para definir variables de entorno.

**Solución permanente (multiplataforma) — `cross-env`:**
1. Instalar la dependencia:
   ```powershell
   pnpm add -D cross-env
   ```
2. En el `package.json` del paquete (`db/package.json`), anteponer `cross-env` a la variable en el script:
   ```json
   {
     "scripts": {
       "test": "cross-env TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test vitest"
     }
   }
   ```
3. Ejecutar simplemente:
   ```powershell
   pnpm test
   ```

---

## 5. `la autentificación password falló para el usuario «netryx»`

**Causa:** el usuario `netryx` (usado en la cadena de conexión del proyecto) todavía no existe en la instancia local de Postgres.

**Solución:** crear el usuario con la contraseña esperada por el proyecto:
```powershell
psql -U postgres -c "CREATE USER netryx WITH PASSWORD 'changeme' SUPERUSER;"
```

Luego volver a correr:
```powershell
pnpm test
```

---

## 6. Tests fallan: extensiones `vector` / `postgis` no existen

**Síntoma:**
```
FAIL  test/migrations.test.ts > init migration > enables vector and postgis extensions
expected false to be true

FAIL  test/migrations.test.ts > init migration > creates all expected tables
error: no existe la relación «areas»
error: no existe la relación «system_settings»
```

**Causa:** las migraciones fallan al ejecutar `CREATE EXTENSION vector;` / `CREATE EXTENSION postgis;` porque ninguna de las dos viene preinstalada por defecto en PostgreSQL para Windows. Al fallar la migración, no se crea ninguna tabla (`areas`, `system_settings`, etc.), y por eso fallan los 4 tests en cadena.

**Solución:**

### 6.1 Instalar PostGIS (vía Stack Builder, incluido con el instalador oficial)
1. Abrir **Application Stack Builder** desde el menú de inicio de Windows.
2. Seleccionar la instalación de PostgreSQL correspondiente → **Next**.
3. Desplegar **Spatial Extensions** → marcar **PostGIS** (versión más reciente disponible).
4. **Next** y aceptar los valores por defecto hasta terminar.

### 6.2 Instalar pgvector (binarios manuales — no viene en Stack Builder)
1. Descargar el ZIP de binarios precompilados para Windows correspondiente a la versión de Postgres instalada (16 o 17) desde el repositorio de pgvector en GitHub.
2. Descomprimir el ZIP: contiene carpetas `bin`, `lib`, `share`.
3. Copiar el contenido dentro de la instalación de Postgres:
   - `lib/` del ZIP → `C:\Program Files\PostgreSQL\<VERSION>\lib`
   - `share\extension\` del ZIP → `C:\Program Files\PostgreSQL\<VERSION>\share\extension`

### 6.3 Recrear la base de datos y volver a probar
La base `netryx_test` quedó a medias/corrupta por el intento fallido anterior, así que hay que recrearla limpia:
```powershell
dropdb -U postgres netryx_test
createdb -U postgres netryx_test
pnpm test
```

---

## Resumen del flujo completo (Windows, de cero)

```powershell
# 1. Añadir <PG_INSTALL>\bin al PATH del sistema y reiniciar la terminal

# 2. Crear el rol que espera el proyecto
psql -U postgres -c "CREATE USER netryx WITH PASSWORD 'changeme' SUPERUSER;"

# 3. Instalar PostGIS vía Stack Builder
# 4. Instalar pgvector copiando los binarios precompilados a lib/ y share/extension/

# 5. Crear la base de test
createdb -U postgres netryx_test

# 6. Usar cross-env en package.json para las variables de entorno (ver sección 4)

# 7. Correr los tests
cd db
pnpm install
pnpm test
```
