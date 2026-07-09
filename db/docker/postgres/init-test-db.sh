#!/bin/bash
# Se ejecuta autom�ticamente al crear el contenedor por primera vez
# (carpeta /docker-entrypoint-initdb.d/). Crea la base netryx_test
# adem�s de la base principal (POSTGRES_DB), usando el mismo rol.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE netryx_test OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'netryx_test')\gexec
EOSQL
