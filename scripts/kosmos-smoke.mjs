import { runKosmos } from "../dist/kosmos/index.js";

const run = await runKosmos(
  { tenantId: "smoke-test" },
  ["software:smoke"],
  {
    async observe(targetId) {
      return [{
        targetId,
        source: "smoke-adapter",
        kind: "test-observation",
        claims: { vulnerability: false, stale: false },
        confidence: 1,
      }];
    },
  },
);

if (run.policyVersion !== "1.0.0" || run.tasks[0]?.status !== "validated" || run.evidence.length !== 1) {
  throw new Error("Kosmos smoke test failed");
}
console.log("Kosmos smoke test passed:", run.id);
