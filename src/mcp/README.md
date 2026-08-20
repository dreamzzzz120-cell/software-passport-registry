# SPR Trust MCP

SPR exposes a read-only Model Context Protocol surface for AI agents.

## Tools

- `verify_software`
- `get_passport`
- `get_trust_evidence`
- `get_security_status`
- `get_compliance_status`
- `check_freshness`
- `verify_claim`

## Security contract

The MCP surface is intentionally read-only. It must never expose credentials, API keys, cookies, authorization headers, webhook secrets, internal source URLs, tenant-private findings, or mutable administrative operations.

Every production request must authenticate the calling agent, resolve the tenant from the authenticated principal rather than request parameters, enforce the same public/evidence authorization boundary as the existing Passport API, validate tool arguments against the schemas, rate-limit requests, and fail closed when evidence is unavailable.

Agents must receive evidence-backed status values only. The server must not manufacture a trust score or compliance claim when evidence is missing or stale.
