#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const report = resolve(root, "artifacts/lom-report.json");
mkdirSync(resolve(root, "artifacts"), { recursive: true });

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "lom:scan"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

let lom = null;
try { lom = JSON.parse(readFileSync(report, "utf8")); } catch {}

const kosmos = {
  schema: "spr-kosmos-run/1.0.0",
  generatedAt: new Date().toISOString(),
  policyVersion: "1.0.0",
  source: "SPR-LOM",
  status: lom?.status ?? "FAILED",
  inventoryCount: lom?.inventoryCount ?? 0,
  findingCounts: lom?.findingCounts ?? {},
  findings: lom?.findings ?? [],
  exitCode: result.status ?? 1,
};

writeFileSync(resolve(root, "artifacts/kosmos-run.json"), JSON.stringify(kosmos, null, 2));
console.log("Kosmos run written to artifacts/kosmos-run.json");
process.exit(kosmos.status === "FAILED" ? 1 : 0);
