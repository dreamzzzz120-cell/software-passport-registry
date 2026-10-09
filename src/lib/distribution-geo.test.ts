import { describe, expect, it } from 'vitest';
import { hasVerifiedNorthAmericanCountry } from './distribution-geo.ts';

const proof = 'https://example.org/contact/company-address';
describe('automated outreach geographic eligibility', () => {
  it.each(['CA', 'US', 'ca', 'us'])('allows explicit country %s backed by evidence', (verifiedCountryCode) => {
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode, verifiedCountryEvidenceUrl: proof })).toBe(true);
  });
  it.each(['GB', 'DE', 'FR', '', 'Canada', 'United States'])('blocks unapproved or ambiguous country %s', (verifiedCountryCode) => {
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode, verifiedCountryEvidenceUrl: proof })).toBe(false);
  });
  it('blocks missing or malformed country evidence', () => {
    expect(hasVerifiedNorthAmericanCountry(null)).toBe(false);
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode: 'CA' })).toBe(false);
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode: 'US', verifiedCountryEvidenceUrl: 'http://example.org/' })).toBe(false);
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode: 'CA', verifiedCountryEvidenceUrl: 'not a URL' })).toBe(false);
    expect(hasVerifiedNorthAmericanCountry({ verifiedCountryCode: 'CA', verifiedCountryEvidenceUrl: 'https://username:password@example.org' })).toBe(false);
  });
  it('does not infer a country from company email or source URL', () => {
    expect(hasVerifiedNorthAmericanCountry({ email: 'sales@example.ca', source_url: 'https://example.ca' })).toBe(false);
  });
});
