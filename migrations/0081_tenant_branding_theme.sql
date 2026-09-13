BEGIN;

-- White-label theme. tenant_branding (0030) held only a company name, one
-- brand colour and a logo, and the only consumer was the Reports PDF export.
-- The White-label page now lets a tenant restyle the whole workspace shell
-- (product name, tagline, every palette token for light and dark, font,
-- corner radius, favicon, footer/support details, attribution). Those are
-- display packaging only and are stored as one validated JSON document; the
-- three original columns stay as they are because ReportsView still reads
-- them. Validation of the document's shape happens in the API (brandingSchema
-- in src/routes/auth.ts); the database only guarantees it is a JSON object.
ALTER TABLE tenant_branding ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_branding_theme_is_object') THEN
    ALTER TABLE tenant_branding ADD CONSTRAINT tenant_branding_theme_is_object CHECK (jsonb_typeof(theme) = 'object');
  END IF;
END $$;

COMMIT;
