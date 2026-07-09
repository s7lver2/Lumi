# Postgres + PostGIS + pgvector, todo preinstalado.
# Elimina por completo el flujo manual de docs/problems.md (Stack Builder,
# binarios de pgvector a mano, PATH, etc.) — esto se construye una vez y
# funciona igual en Windows, Mac, Linux o un servidor en producción.

FROM postgis/postgis:17-3.5

# pgvector está empaquetado para Debian/Ubuntu como postgresql-<version>-pgvector
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgvector \
    && rm -rf /var/lib/apt/lists/*

# Crea automáticamente la base de test además de la base principal
# (POSTGRES_DB solo crea una), para que `pnpm test` funcione sin pasos extra.
COPY init-test-db.sh /docker-entrypoint-initdb.d/10-init-test-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/10-init-test-db.sh
