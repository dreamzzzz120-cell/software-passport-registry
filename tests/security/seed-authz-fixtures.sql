BEGIN;

INSERT INTO users (uid,email,tenant_id,role,company_name,onboarded,mfa_enabled)
VALUES
  (:'tenant_a_uid','tenant-a@security.test','tenant-a','Admin','Security Test A',1,0),
  (:'tenant_b_uid','tenant-b@security.test','tenant-b','Admin','Security Test B',1,0)
ON CONFLICT (uid) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, role=EXCLUDED.role, onboarded=1;

-- Route-authorization fixtures exercise tenant isolation, not billing denial.
-- Seed real entitling plans so the request reaches the authorization boundary
-- now that launch policy correctly blocks unpaid workspaces.
INSERT INTO tenant_subscriptions (tenant_id, plan, status, client_limit)
VALUES
  ('tenant-a','enterprise','active',NULL),
  ('tenant-b','enterprise','active',NULL)
ON CONFLICT (tenant_id) DO UPDATE
SET plan=EXCLUDED.plan, status=EXCLUDED.status, client_limit=EXCLUDED.client_limit, updated_at=CURRENT_TIMESTAMP;

INSERT INTO clients (id,tenant_id,name,domain,industry,joined_date)
VALUES
  ('security-client-a','tenant-a','Security Client A','a.security.test','Security','2026-01-01'),
  ('security-client-b','tenant-b','Security Client B','b.security.test','Security','2026-01-01')
ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id;

INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,release_date,file_hash,license_type)
VALUES
  ('security-passport-a','tenant-a','security-client-a','Tenant A Security Passport','1.0.0','SPR Security Test','security','2026-01-01','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','MIT'),
  ('security-passport-b','tenant-b','security-client-b','Tenant B Security Passport','1.0.0','SPR Security Test','security','2026-01-01','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','MIT')
ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, client_id=EXCLUDED.client_id;

COMMIT;
