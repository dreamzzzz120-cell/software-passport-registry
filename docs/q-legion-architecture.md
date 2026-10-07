# SPR Q-LEGION

Q-LEGION is SPR's governed mission architecture for coordinated agent teams.

It does **not** replace SPR's evidence model. It does **not** make probabilistic output authoritative. It does **not** allow an agent to grant itself execution authority.

## Core loop

OBSERVE → GENERATE STRATEGIES → RED-TEAM → JUDGE → AUTHORIZE → EXECUTE ELSEWHERE → VERIFY → RECEIPT → LEARN

The first implementation lives in `src/agents/q-legion.ts` and is deliberately pure. It makes no network calls and mutates no tenant state.

## Invariants

- UNKNOWN remains UNKNOWN.
- Probabilities are advisory only and never become evidence.
- Required evidence references must exist and be action-grade.
- Red-team BLOCKER findings veto a strategy.
- Judge rejection vetoes a strategy.
- Reversible and partially reversible actions require externally issued Constellation authority.
- Irreversible actions require HUMAN authority.
- Agents cannot self-authorize.
- Authority must be scoped to the mission or strategy.
- Every decision can be converted to a compact provenance receipt.

## Mission cells

A future mission can assemble temporary specialists instead of relying on one general-purpose agent:

- Recon / Market Cartographer
- Pain Miner
- Proof Miner
- Revenue Architect
- Buyer Skeptic
- Evidence Prosecutor
- Judge
- Next-Best-Action operator
- Follow-up operator
- Money Leak Hunter

The organizational unit is the mission cell, not the individual model call.

## Parallel strategies

A mission may carry several candidate strategies at once. Q-LEGION keeps them independent until the evidence, adversarial review, judge review, and authority requirements are satisfied. Eligible candidates are ranked deterministically by advisory probability, then expected net value, then stable strategy id.

This is not quantum computing. “Quantum” here describes the product's parallel hypothesis/strategy model: many candidate futures can remain open until evidence eliminates them.

## Product boundaries

SPR remains the **Reality / Evidence Engine**.

Constellation remains the **Authority / Execution Engine** and is the intended issuer of machine authority grants.

Datasphere remains the future **historical receipt / temporal reconstruction layer**.

Q-LEGION is the **mission intelligence layer** between evidence and governed execution.

## Production rollout

Phase 1 (this change): deterministic mission core + contracts.

Phase 2: tenant-scoped persistence for mission definitions, strategy states, adversarial findings, judge reviews, and receipts.

Phase 3: Founder Mission Control read-only Q-LEGION view.

Phase 4: shadow / ghost execution where candidate cells observe live missions but have no action authority.

Phase 5: Constellation-issued short-lived capability grants for reversible actions.

Phase 6: outcome calibration, agent reputation by domain, controlled strategy experiments, and after-action learning.

No later phase should be considered complete until deployed behavior is production verified.
