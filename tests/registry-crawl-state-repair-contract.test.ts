import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Migration 0097: registry_crawl_state repair contract", () => {
  const migrationPath = path.join(
    __dirname,
    "../migrations/0097_repair_registry_crawl_state_columns.sql"
  );
  const migration0091Path = path.join(
    __dirname,
    "../migrations/0091_distribution_sender_verifications.sql"
  );

  let migrationContent: string;
  let migration0091Content: string;

  it("should read migration 0097", () => {
    migrationContent = fs.readFileSync(migrationPath, "utf-8");
    expect(migrationContent).toBeTruthy();
    expect(migrationContent.length).toBeGreaterThan(0);
  });

  it("should read migration 0091", () => {
    migration0091Content = fs.readFileSync(migration0091Path, "utf-8");
    expect(migration0091Content).toBeTruthy();
    expect(migration0091Content.length).toBeGreaterThan(0);
  });

  it("should verify strategy_index and query_index are added with IF NOT EXISTS", () => {
    expect(migrationContent).toContain("strategy_index integer NOT NULL DEFAULT 0");
    expect(migrationContent).toContain("query_index integer NOT NULL DEFAULT 0");
    expect(migrationContent).toContain("ADD COLUMN IF NOT EXISTS strategy_index");
    expect(migrationContent).toContain("ADD COLUMN IF NOT EXISTS query_index");
  });

  it("should verify refreshed, quarantined, failed columns are added to registry_crawl_runs", () => {
    expect(migrationContent).toContain("ADD COLUMN IF NOT EXISTS refreshed integer");
    expect(migrationContent).toContain("ADD COLUMN IF NOT EXISTS quarantined integer");
    expect(migrationContent).toContain("ADD COLUMN IF NOT EXISTS failed integer");
  });

  it("should be wrapped in transaction (BEGIN/COMMIT)", () => {
    expect(migrationContent).toMatch(/^BEGIN;/m);
    expect(migrationContent).toMatch(/COMMIT;\s*$/m);
  });

  it("should be distinct from migration 0091", () => {
    expect(migration0091Content).toContain("registry_ingestion_items");
    expect(migrationContent).not.toContain("registry_ingestion_items");
    expect(migrationContent).toContain("Repair migration");
  });

  it("should include permission grants for spr_worker_runtime and spr_app_runtime", () => {
    expect(migrationContent).toContain("spr_worker_runtime");
    expect(migrationContent).toContain("spr_app_runtime");
    expect(migrationContent).toContain("GRANT");
  });
});
