#!/bin/sh
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE "core";
    ALTER DATABASE "core" OWNER TO postgres;
    GRANT ALL PRIVILEGES ON DATABASE "core" TO postgres;
    CREATE DATABASE "core_test";
    ALTER DATABASE "core_test" OWNER TO postgres;
    GRANT ALL PRIVILEGES ON DATABASE "core_test" TO postgres;
EOSQL
