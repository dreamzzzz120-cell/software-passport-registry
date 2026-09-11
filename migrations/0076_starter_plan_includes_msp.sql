-- MSP Starter is sold as an MSP plan; it must include the MSP command center.
-- Observed 2026-09-11: a tenant that had just paid for MSP Starter received
-- 402 on /api/msp because plan_capabilities granted 'msp' only to pilot,
-- growth and enterprise. Founder decision: Starter includes msp.
BEGIN;
INSERT INTO plan_capabilities (plan, capability) VALUES ('starter', 'msp')
ON CONFLICT (plan, capability) DO NOTHING;
COMMIT;
