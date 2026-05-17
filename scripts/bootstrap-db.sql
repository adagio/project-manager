-- Bootstrap script for the project-manager PoC.
-- Run as postgres root, once:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d PoCs_DB -f scripts/bootstrap-db.sql
--
-- Creates a dedicated role + schema (matches the existing
-- `music` / `que_interesante` convention already present in PoCs_DB):
--   role:   project_manager_db_user
--   schema: project_manager (owned by the role)

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'project_manager_db_user') THEN
    CREATE ROLE project_manager_db_user WITH LOGIN PASSWORD 'project_manager_db_user';
  END IF;
END $$;

GRANT CONNECT ON DATABASE "PoCs_DB" TO project_manager_db_user;

CREATE SCHEMA IF NOT EXISTS project_manager AUTHORIZATION project_manager_db_user;

GRANT USAGE, CREATE ON SCHEMA project_manager TO project_manager_db_user;
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA project_manager TO project_manager_db_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA project_manager TO project_manager_db_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA project_manager GRANT ALL ON TABLES    TO project_manager_db_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA project_manager GRANT ALL ON SEQUENCES TO project_manager_db_user;
