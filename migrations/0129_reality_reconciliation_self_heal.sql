BEGIN;

-- 0129: authorize bounded, reversible self-repair for stale worker leases and orphaned scans.
-- Class 1 is limited operational recovery: no trust/evidence conclusions are invented.
UPDATE reality_contracts
   SET repair_class = 1,
       updated_at = now()
 WHERE id IN ('worker_queue_flow', 'scan_terminality');

COMMIT;
