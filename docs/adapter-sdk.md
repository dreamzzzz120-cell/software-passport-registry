# SPR Adapter SDK Contract

SPR integrations must extend the platform without changing the trust core.

## Stable boundary

A new technology integrates through:

1. **Adapter manifest** — declares identity, protocol version, auth mode and observable capabilities.
2. **Evidence adapter** — collects real provider data and emits `spr.evidence-envelope.v1`.
3. **Evidence ledger** — persists observed evidence. Raw evidence is authoritative input.
4. **Policy plugin** — optional, versioned interpretation of evidence. Policies never rewrite evidence.
5. **Derived trust state** — scoring/reporting may change over time and can always be recomputed from evidence.
6. **Events** — downstream automation reacts to versioned SPR events rather than coupling directly to collectors.

## Non-negotiable rules

- UNKNOWN is the default when a capability cannot be observed.
- A planned connector capability is never reported as supported.
- An adapter must not create a trust score.
- An adapter must not convert missing data into PASS.
- Provider payloads are untrusted input.
- Credentials stay server-side.
- Evidence carries provider, adapter version, subject identity, observation time, provenance and limitations.
- Policy decisions cite evidence IDs.
- Derived scoring remains replaceable.
- New protocol/schema versions are additive. Existing evidence remains readable.

## Adding a provider

Implement an `EvidenceAdapter` from `src/integrations/capability-manifest.ts`.

The adapter should:
- publish an `AdapterManifest`;
- declare only capabilities the provider can actually expose;
- collect requested capabilities;
- emit a versioned evidence envelope for every observation;
- emit UNKNOWN evidence with an explicit limitation when an expected capability cannot be observed;
- preserve the provider's source identity and response hash;
- fail closed on authentication, transport or provenance errors.

Register the provider in the universal integration fabric only after the adapter's real authenticated path is implemented and tested. Keep it `planned` until then.

## Compatibility rule

Future scanners, AI providers, RMMs, PSA systems, cloud platforms, firmware systems, robotics, agents, models or formats should require an adapter and possibly a policy plugin—not modifications to the evidence ledger or canonical scoring engine.
