# ECC Agent Tooling for SPR

This repository uses a deliberately scoped subset of Everything Claude Code (ECC), vendored under `.claude/`.

## Enabled skills

- verification-loop
- security-review
- search-first
- prompt-optimizer
- coding-standards
- frontend-patterns
- api-design
- parallel-execution-optimizer

## SPR operating rules

SPR-specific architecture, security, deployment, and product rules remain authoritative. ECC guidance is supplemental and must not override existing SPR requirements.

Production claims require evidence: do not claim a feature is deployed, working, merged, or verified without repository/deployment evidence and, where applicable, a live smoke test.

Parallel work must use isolated write surfaces. Do not parallelize destructive operations, migrations, shared-file edits, or customer-impacting production deploys without an explicit gate.

## Intentionally excluded

- ECC hooks/runtime
- full ECC skill catalog
- unrelated language/framework packs
- prediction-market/Itô workflows
- media/content creation workflows
- Kubernetes/ML/mobile-specific workflows
- autonomous mass outbound automation

## Source

ECC is MIT licensed. These files are sourced from the official ECC repository and should be refreshed deliberately when upgrading ECC.
