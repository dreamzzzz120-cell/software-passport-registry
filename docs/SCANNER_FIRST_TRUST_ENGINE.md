# Scanner-First Trust Engine

## Product boundary

SPR's entry point is an automated software verification utility, not a passive directory.

A customer can submit a supported software source or evidence and receive an evidence-backed Software Passport without waiting for the software vendor to voluntarily publish a record.

The public registry is a durable index produced by those observations. It is not a prerequisite for the first customer to receive value.

## Canonical pipeline

1. **Acquire** — obtain the permitted software source and resolve the real default branch unless a revision is explicitly pinned.
2. **Inventory** — enumerate files and preserve explicit disposition states for files that are ignored, unsupported, skipped, failed, inaccessible, partial or analyzed.
3. **Blueprint** — build dependency/SBOM evidence and preserve source identity, revision and hashes.
4. **Observe** — run vulnerability, secret, IaC/configuration, license and other supported scanners.
5. **Verify** — evaluate evidence through the authoritative verification policy.
6. **Passport** — persist the software identity, evidence, findings, verification state and observation history.
7. **Monitor** — re-run observation so a historical review is not treated as permanent truth.
8. **Registry** — publish only records whose underlying observations meet the public-registry eligibility rules.

## Hardening invariants

- A scan failure is never represented as a clean scan.
- Missing evidence is never converted into a positive claim.
- Unsupported files remain accounted for instead of disappearing through a filter.
- Scores remain null/unknown when there is no legitimate measurement.
- A public passport must not imply certification that SPR did not independently verify.
- Anonymous Free Review jobs use the same repository-scan submission and worker path as authenticated repository scans.
- Repository identifiers are validated again at the queue boundary, not only at HTTP boundaries.
- Tenant scope is carried into scans, jobs, evidence, findings and passport reads.
- Registry entries are derived from observed evidence and observation timestamps, not vendor declarations alone.

## Commercial model enabled by this architecture

The scanner creates immediate utility before network effects exist.

- **Free Review:** demonstrate the workflow on a public repository.
- **Software Passport:** persistent evidence-backed software identity.
- **Continuous Verification:** scheduled re-observation and change detection.
- **MSP:** multi-client software verification and white-label delivery.
- **Enterprise:** portfolio/vendor software verification and policy workflows.
- **API:** machine-readable trust and evidence access.

The registry becomes the accumulated intelligence layer created by usage rather than a marketplace that must first convince every vendor to participate.
