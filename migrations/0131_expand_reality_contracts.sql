BEGIN;

-- 0131: Expand Autonomous Reality Reconciliation beyond queue/database health.
-- These contracts intentionally preserve UNKNOWN when live proof is unavailable.
INSERT INTO reality_contracts (id, component, description, expected, repair_class)
VALUES
  ('worker_runtime_identity','Worker runtime','Worker uses the least-privileged runtime role over TLS.', '{"role":"spr_worker_runtime","tls":true}'::jsonb,2),
  ('tenant_isolation_integrity','Tenant isolation','Database RLS invariant assertion succeeds.', '{"rlsAssertion":true}'::jsonb,3),
  ('auth_backend_reachable','Authentication','Configured authentication backend answers a live health request.', '{"liveHealth":true}'::jsonb,2),
  ('billing_backend_reachable','Billing','Stripe is reachable when billing is configured or active subscriptions exist.', '{"liveHealth":true}'::jsonb,2),
  ('intake_storage_readiness','Intake storage','Uploads that require object storage are not blocked by missing broker configuration.', '{"storageAvailableWhenNeeded":true}'::jsonb,2),
  ('sbom_evidence_completeness','SBOM pipeline','Recent completed repository security scans persist SBOM evidence.', '{"recentCompletedScansHaveSbomEvidence":true}'::jsonb,2),
  ('report_delivery_flow','Report delivery','Enabled report schedules are processed without stale overdue runs or persistent errors.', '{"overdueSchedules":0,"erroredSchedules":0}'::jsonb,1),
  ('integration_delivery_health','External integrations','Enabled monitoring integrations do not accumulate repeated collection failures.', '{"repeatedFailures":0}'::jsonb,2),
  ('malware_coverage','Malware scanning','Malware scan evidence is observable when malware inspection is part of active scan coverage.', '{"coverageObserved":true}'::jsonb,2),
  ('public_deployment_ready','Public deployment','The configured public SPR origin resolves over TLS and its /ready contract passes.', '{"ready":true,"https":true}'::jsonb,2),
  ('backup_restore_evidence','Backup / restore','A recent operator-verified backup or restore proof is recorded.', '{"verifiedWithinHours":168}'::jsonb,2)
ON CONFLICT (id) DO UPDATE SET
  component=EXCLUDED.component,
  description=EXCLUDED.description,
  expected=EXCLUDED.expected,
  repair_class=EXCLUDED.repair_class,
  enabled=TRUE,
  updated_at=now();

COMMIT;
