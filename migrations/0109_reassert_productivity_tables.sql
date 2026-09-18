-- SPDX-License-Identifier: Apache-2.0
-- Reassert the five tables reported missing by production schema-drift audit.
-- Idempotent: never drops or alters existing tables/data.

BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  github_username text,
  bio text
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id integer NOT NULL REFERENCES app_users(id),
  github_url text,
  description text
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  project_id text NOT NULL REFERENCES projects(id),
  description text,
  due_date timestamp
);

CREATE TABLE IF NOT EXISTS snippets (
  id text PRIMARY KEY,
  title text NOT NULL,
  language text NOT NULL,
  content text NOT NULL,
  creator_id integer NOT NULL REFERENCES app_users(id),
  description text,
  tags text
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES app_users(id),
  last_active_at timestamp NOT NULL,
  active_file_path text,
  active_branch text
);

COMMIT;
