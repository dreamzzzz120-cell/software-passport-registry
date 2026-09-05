# Third-party license inventory

SPR is proprietary. Third-party software remains under its own license and is not relicensed by the SPR project license.

## npm dependency

- `limiter` — MIT License. The npm package metadata identifies version 3.0.0 as MIT licensed.

## GitHub Actions

The workflows in `.github/workflows/` reference the following third-party actions:

- `actions/checkout` — MIT License.
- `actions/setup-node` — MIT License.
- `actions/upload-artifact` — MIT License.
- `github/codeql-action` — MIT License for the action project; the underlying CodeQL CLI is separately governed by GitHub CodeQL Terms and Conditions.
- `gitleaks/gitleaks-action` v2 — governed by the Gitleaks Action End-User License Agreement (EULA), not MIT. The v2 action's repository explicitly notes the license change from MIT beginning with v2.0.0.

The exact action commits used by SPR are pinned in the workflow files. This inventory records the upstream licensing basis; it does not grant SPR ownership of third-party software.

## Verification sources

- `limiter`: npm package metadata and license notice.
- `actions/checkout`: upstream repository license metadata.
- `actions/setup-node`: upstream repository license metadata.
- `actions/upload-artifact`: upstream repository license metadata.
- `github/codeql-action`: upstream repository license metadata and CodeQL terms notice.
- `gitleaks/gitleaks-action`: upstream repository LICENSE/EULA and README license-change notice.

Review this file when a pinned action or dependency is upgraded or replaced.
