# Agent & MCP evidence threat model

SPR remains an evidence and provenance platform. This capability does not turn SPR into an AI runtime firewall and does not replace Constellation's authorization/execution role.

## External research reference

ClawSecure, *The AI Agent Threat Report* (2026):
https://www.clawsecure.ai/research/ai-agent-threat-report

The report's core findings that matter to SPR are:

- indirect prompt injection can arrive through ordinary content an agent reads;
- MCP/tool access can turn a content-layer compromise into credential access, data exfiltration, or unintended actions;
- model self-judgment is not sufficient proof that an input or action is safe;
- tool and platform provenance, configuration, permissions, and observable execution evidence need to be inspected independently.

SPR does not copy ClawSecure's product model or treat the report's vendor-specific measurements as universal facts. It uses the report as an external threat-model input and preserves independent evidence semantics.

## SPR controls

The Agent/MCP evidence layer records:

- observed agents, MCP servers, CLI tools, integrations, and agent configuration assets;
- source type, source identifier, origin, evidence hash, first/last observation time, and verification state;
- current capability snapshots with read/write/execute/admin/unknown scope;
- agent/tool relationships for graph expansion;
- prompt-injection indicators;
- credential-exposure indicators;
- exfiltration indicators;
- abnormal tool-call indicators;
- response-integrity failures;
- configuration drift;
- excessive tool scope;
- unverified MCP observations;
- dangerous tool chains;
- execution receipts.

## Non-negotiable evidence rules

1. Ingestion may record OBSERVED or UNKNOWN. It may not self-assert VERIFIED.
2. Suspicion is not execution. UNKNOWN and NOT_OBSERVED remain explicit outcomes.
3. SUCCEEDED is accepted only for execution-receipt events and requires evidence references.
4. Capability observations replace the previous capability snapshot so revoked scope does not remain visible.
5. Structured metadata/detail must be bounded and must not retain raw credential-like fields.
6. Future-dated observations beyond a small clock-skew allowance are rejected.
7. All new tables are tenant-scoped and protected by RLS.
8. SPR records evidence and findings; runtime authorization remains outside SPR.
9. No mock agent security data is introduced.

## Product-surface rule

Agent security remains a contained capability inside the existing AI Trust Center, Evidence Explorer, Graph, Findings, Monitoring, and reporting surfaces. It must not become a second top-level product unless product strategy explicitly changes.
