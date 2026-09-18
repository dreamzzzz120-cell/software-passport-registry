BEGIN;

-- 0106: make durable scan inventory genuinely scan-rooted.
-- A scan is authoritative even when passport derivation fails or is still pending.
ALTER TABLE public.scan_file_inventory ALTER COLUMN passport_id DROP NOT NULL;
ALTER TABLE public.scan_coverage ALTER COLUMN passport_id DROP NOT NULL;

-- The inventory indexes remain useful with NULL passport association.
COMMIT;
