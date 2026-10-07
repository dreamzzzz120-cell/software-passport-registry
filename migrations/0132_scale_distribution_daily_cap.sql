BEGIN;

ALTER TABLE distribution_campaign_settings
  DROP CONSTRAINT IF EXISTS distribution_campaign_settings_daily_send_cap_check;

ALTER TABLE distribution_campaign_settings
  ADD CONSTRAINT distribution_campaign_settings_daily_send_cap_check
  CHECK (daily_send_cap BETWEEN 1 AND 1000);

COMMIT;
