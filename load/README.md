# SPR production load verification

This directory contains a bounded, non-destructive k6 profile for release verification.

## Safe default

The test defaults to `http://127.0.0.1:5000` so it cannot accidentally generate production traffic.

Run locally against a staging environment by setting `BASE_URL`:

```bash
BASE_URL=https://staging.example.com k6 run load/production-smoke.js
```

For an authenticated smoke path, provide a short-lived Firebase ID token through `SPR_ID_TOKEN`. Never commit a token or place it in source control.

The profile intentionally uses read-only endpoints. It does not create clients, passports, scans, payments, integrations, or other customer data.

## Production verification

Production testing should be run only during an approved maintenance/release window and with conservative rates. Start with the defaults, review latency/error thresholds, then increase traffic in controlled steps if required.

The script checks:

- public application availability;
- health/readiness endpoint behavior;
- authentication boundary behavior;
- p95 latency under 750 ms;
- p99 latency under 1.5 s;
- HTTP failure rate under 1%.

A successful run is evidence for release verification; it is not a substitute for capacity planning, database failover testing, provider-specific quota testing, or a formal security assessment.
