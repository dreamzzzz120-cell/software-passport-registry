# Security gate notes

The hardening gate is intentionally evidence-first. It blocks high-severity production dependency vulnerabilities, runs the full type/test/build pipeline, detects tracked private-key material, rejects tracked local/production environment files, and reviews dependency changes on pull requests.
