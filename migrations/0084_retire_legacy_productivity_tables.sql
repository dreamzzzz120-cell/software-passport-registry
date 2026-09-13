-- SPDX-License-Identifier: Apache-2.0
-- SPR-APPROVED-DESTRUCTIVE-MIGRATION
-- Retire the obsolete developer-productivity tables created by the base schema.
-- These tables are outside the active SPR tenant-scoped application model.
-- Migration Safety permits this exact reviewed migration only.

BEGIN;

DROP TABLE IF EXISTS work_sessions;
DROP TABLE IF EXISTS snippets;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS app_users;

COMMIT;
