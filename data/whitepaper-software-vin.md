# Why the Software Supply Chain Needs a Software VIN
### And where SCA scanners stopped short

*Software Passport Registry Ltd. Every product claim below describes behaviour that exists in the SPR codebase today; there are no market-size figures or third-party statistics in this document because none were independently verified for it.*

---

## The problem an MSP actually has

A managed service provider runs software it did not write, for clients who did not choose it, under compliance obligations neither party fully reads. When a client asks "is this tool safe to keep?", the honest answer today is assembled from three unreliable sources:

1. **The vendor's own claims.** A security page, a SOC 2 badge, a questionnaire answered by sales. None of it is observed; all of it is asserted.
2. **A point-in-time scan.** An SCA tool run once, by someone, on some version, producing a PDF nobody can reproduce.
3. **Nothing.** For most of the long tail — the RMM plug-in, the PowerShell module, the open-source library inside the vendor's product — there is simply no record at all.

A car does not have this problem. Every vehicle carries a VIN: a persistent identity that outlives its owners, to which inspections, recalls and title history attach over time. You do not ask the manufacturer whether the car is safe; you look up what has been *observed* about that specific vehicle.

Software has identities (a package name, a repository, a commit hash) but no registry that attaches observations to them and keeps them. That is the gap.

## What a Software VIN is

A Software VIN is a persistent identity for a specific piece of software — a repository at a commit, a package at a version — to which independently observed evidence accumulates:

- **Identity** — provider, owner, name, the immutable commit or version that was actually examined. Not "the latest", not "whatever the vendor shipped": the exact bytes.
- **Observations** — what an automated, reproducible process found when it looked: the bill of materials, known vulnerabilities in those components, secrets and configuration issues in the tree, licence signals.
- **Evidence** — each observation stored as an evidence item with a hash, a source, a timestamp and the engine that produced it, so any claim on the passport can be traced to the artifact that supports it.
- **History** — the passport is re-observed over time; changes are recorded as changes, not overwritten.

The registry does not need the vendor's permission to do any of this, because it observes rather than asks.

## Where SCA tools stopped short

Software composition analysis is a necessary component and an insufficient product. Three specific limits:

**1. A scan is an event; a passport is a record.** An SCA run answers "what is in this build right now?" and then is gone. There is no persistent identity the result attaches to, so the next person to ask starts from zero. A registry keeps the observation against the software's identity, so the question "what has ever been observed about this?" has an answer.

**2. SCA output is a claim about a tree, not evidence about a supply chain.** A findings list without provenance — which engine, which database version, which commit, which timestamp, what hash — cannot be audited. SPR stores every observation as an evidence item with exactly those fields, and stores the passport's own verification status, confidence and completeness as separately derived values that are allowed to be *null* when nothing was measured. A null is never coalesced to zero, because "no measurement" and "measured as zero risk" are different facts.

**3. SCA tools do not distinguish "claimed fixed" from "verified fixed".** When a technician closes a ticket, most tooling treats the finding as resolved. SPR's model is explicit: a ticket closure moves a finding to a *claimed* state; only a fresh observation by the verification path can move it to *verified*. A human assertion is recorded as a human assertion. This is the single rule that keeps the registry honest under real operational pressure, and it is enforced in code, not policy.

## What SPR observes, concretely

For a public repository (or a private one, with the customer's own credential):

- The repository is acquired at a resolved, immutable commit.
- A CycloneDX software bill of materials is generated with **Syft** (currently pinned at 1.49.0) from the manifests actually present.
- Every component is checked against the **OSV** vulnerability database; each response is stored as an evidence item with a content hash.
- The tree is scanned for secrets, infrastructure-as-code misconfiguration and licence signals.
- Findings are recorded with severity, category, component and fix version where OSV provides one; each is a row in a tamper-evident chain.

Everything the public page for that software shows is drawn from those rows. If a scan did not complete, the page says so; it does not show a score.

## What the registry refuses to do

Credibility is mostly a list of refusals:

- It will not display a score for software it has not examined.
- It will not treat the absence of a finding as proof of safety; every page says so.
- It will not let a vendor, a ticket, or a questionnaire mark anything verified.
- It will not restate a price, a status, or a count that another system owns; it reads them from that system.
- It will not silently downgrade a failed verification to "unknown" and move on.

## What this means for an MSP

- **Procurement**: look up the software VIN before signing; see what has been observed, at which commit, when.
- **Compliance**: hand an auditor an evidence ledger with hashes and timestamps instead of a vendor's PDF.
- **Operations**: get told when a re-observation differs from the last one — a new critical, a changed licence, a component that disappeared.
- **Client conversations**: show the client the passport, in plain English, with the underlying evidence one click away.

## Where to start

Run a free review of any public repository at softwarepassportregistry.com/free-review. The result is a real passport built the way every passport is built. Browse what has already been observed at softwarepassportregistry.com/software.

---

*Open standards used: CycloneDX for the bill of materials; OSV for vulnerability matching. SPR does not require vendor participation to build a passport.*
