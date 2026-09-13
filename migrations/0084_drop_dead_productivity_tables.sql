BEGIN;

-- The following five tables are legacy developer-productivity scaffolding,
-- not part of the SPR domain model. They were confirmed unused by source
-- inspection. Migration 0080 did NOT remove them; it removed only the
-- placeholder self-passport and its dependent rows. Remove these legacy tables
-- explicitly now so the physical database matches the source-model comment.
-- No active SPR table is expected to reference them. If an unexpected foreign
-- key exists, this migration fails safely instead of cascading into unrelated
-- tables.
DROP TABLE IF EXISTS work_sessions;
DROP TABLE IF EXISTS snippets;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS app_users;

COMMIT;
