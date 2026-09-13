# SPR UI Developer Handoff

This branch is a UI-focused source snapshot extracted from the production Software Passport Registry repository at commit `8022e6683e8baad948d63ba50b2be666ab3e06da`.

## Purpose
Give a frontend/UI developer the existing SPR presentation layer so they can substantially improve the visual design and UX without receiving the backend, migrations, workers, scanners, trust engine, security implementation, or production infrastructure.

## Included
- `src/App.tsx`
- `src/main.tsx`
- `src/components/**` — existing React UI
- `src/styles/**` — existing SPR styles
- `src/index.css`
- `src/login-premium.css`
- UI-supporting client modules required by the current UI
- existing public assets/pages
- a frontend-oriented `package.json`

## Do not modify as part of UI work
- Trust scoring or verification rules
- Evidence semantics
- Tenant isolation or authorization
- Billing enforcement
- API security
- Database schemas/migrations
- Workers, scanners, crawlers
- Production secrets or infrastructure

## Core rule
**If SPR cannot observe it, the UI must not claim it.**

Trust/security/compliance values must continue to represent real SPR data or be explicitly marked as demo data.

## Highest-priority screens
1. Homepage
2. MSP landing/pricing
3. MSP Command Center
4. Clients
5. Passports
6. Evidence Dashboard / Evidence Explorer
7. Trust Graph / Trust Room
8. Free Review
9. Reports
10. Monitoring / Alerts
11. Security Center
12. Settings / White Label
13. Public Trust Center
14. Login / onboarding

## Developer objective
Make SPR look and feel like a premium, enterprise-grade trust infrastructure product: clearer hierarchy, better information density, stronger visual storytelling, excellent responsive behavior, accessibility, and polished interaction states.

Do not stop at a mockup. Keep the React screens functional and preserve the existing data/API contracts.

## Integration
This is a design handoff snapshot, not the production deployment. Changes should be reviewed and integrated back into `dreamzzzz120-cell/software-passport-registry` through a normal PR.
