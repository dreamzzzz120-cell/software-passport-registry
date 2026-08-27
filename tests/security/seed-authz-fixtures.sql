BEGIN;

INSERT INTO users (uid,email,tenant_id,role,company_name,onboarded,mfa_enabled)
VALUES
  ('tenant-a-test-user','tenant-a@security.test','tenant-a','Admin','Security Test A',1,0),
  ('tenant-b-test-user','tenant-b@security.test','tenant-b','Admin','Security Test B',1,0)
ON CONFLICT (uid) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, role=EXCLUDED.role, onboarded=1;

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
