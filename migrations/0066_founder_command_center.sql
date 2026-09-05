-- 0066: Founder Command Center growth task list.
-- Global (not tenant-scoped) — this is the platform operator's own checklist,
-- gated app-side by requireFounder (FOUNDER_EMAILS allowlist), not by RLS.

CREATE TABLE IF NOT EXISTS founder_tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('seo','backlinks','outreach','infra','general')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  notes TEXT,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founder_tasks_status ON founder_tasks(status);
CREATE INDEX IF NOT EXISTS idx_founder_tasks_category ON founder_tasks(category);

-- Starter checklist so the page isn't empty on first load. Only inserts if
-- the table is empty, so this is safe to leave in place / re-run.
INSERT INTO founder_tasks (title, category, status, notes)
SELECT * FROM (VALUES
  ('Submit to Capterra / G2 / GetApp MSP-tools categories', 'backlinks', 'open', 'Free listings, real domain authority'),
  ('Get listed on MSP directories (MSPAlliance, ChannelE2E vendor lists)', 'backlinks', 'open', NULL),
  ('Write 1 case study once first MSP client is live', 'seo', 'open', 'Blocked on a real customer — do not fabricate one'),
  ('Publish "CRA compliance for MSPs" explainer page', 'seo', 'open', 'Targets the narrow MSP/CRA go-to-market angle'),
  ('Guest post or podcast appearance in an MSP community (r/msp, MSP Discords, ChannelPro)', 'backlinks', 'open', NULL),
  ('Reach out to 10 local Kelowna/Okanagan MSPs for door-knock validation', 'outreach', 'open', 'Agreed next concrete step'),
  ('Apply / confirm Accelerate Okanagan cohort status', 'outreach', 'open', NULL),
  ('Set up Google Search Console + submit sitemap for softwarepassportregistry.com', 'seo', 'open', 'Ten minutes, do regardless of traffic timeline')
) AS seed(title, category, status, notes)
WHERE NOT EXISTS (SELECT 1 FROM founder_tasks);
