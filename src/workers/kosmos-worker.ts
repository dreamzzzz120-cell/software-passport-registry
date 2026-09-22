import { runKosmos, type KosmosObservation } from "../kosmos/index.ts";
import { persistTrustLoop, type ControlObservation } from "../trust/trust-loop.ts";

const intervalMs = Math.max(60_000, Number.parseInt(process.env.KOSMOS_INTERVAL_MS ?? "300000", 10) || 300000);
const targetUrl = (process.env.KOSMOS_TARGET_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
const passportId = process.env.KOSMOS_PASSPORT_ID ?? "";
const assetId = process.env.KOSMOS_ASSET_ID ?? "";
const tenantId = process.env.KOSMOS_TENANT_ID ?? "";

async function observeTarget(targetId: string): Promise<KosmosObservation[]> {
  if (!targetUrl) throw new Error("KOSMOS_TARGET_URL or APP_URL is required");
  const observations: KosmosObservation[] = [];
  for (const path of ["/health", "/ready"]) {
    const observedAt = new Date().toISOString();
    try {
      const response = await fetch(targetUrl + path, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": "SPR-Kosmos/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      observations.push({
        source: "spr-runtime",
        kind: "runtime-health",
        targetId,
        observedAt,
        confidence: response.status < 400 ? 1 : 0.95,
        claims: {
          endpoint: path,
          httpStatus: response.status,
          healthy: response.ok,
          stale: false,
        },
      });
    } catch (error) {
      observations.push({
        source: "spr-runtime",
        kind: "runtime-health",
        targetId,
        observedAt,
        confidence: 1,
        claims: {
          endpoint: path,
          httpStatus: 0,
          healthy: false,
          runtimeError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return observations;
}

export async function runKosmosObservationCycle() {
  const run = await runKosmos(
    { tenantId: process.env.KOSMOS_TENANT_ID || undefined },
    [process.env.KOSMOS_TARGET_ID || "spr-runtime"],
    { observe: observeTarget },
  );
  console.info(
    "[Kosmos] cycle complete",
    JSON.stringify({
      id: run.id,
      tasks: run.tasks.length,
      evidence: run.evidence.length,
      findings: run.findings.length,
      policyVersion: run.policyVersion,
    }),
  );
  return run;
}

export async function runKosmosWorkerLoop() {
  while (true) {
    try {
      await runKosmosObservationCycle();
    } catch (error) {
      console.error("[Kosmos] cycle failure:", error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
