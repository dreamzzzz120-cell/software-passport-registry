/** Explicit, independently supported geography for automated MSP outreach. */
export function hasVerifiedNorthAmericanCountry(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const row = evidence as Record<string, unknown>;
  const country = typeof row.verifiedCountryCode === 'string' ? row.verifiedCountryCode.trim().toUpperCase() : '';
  if (country !== 'CA' && country !== 'US') return false;
  if (typeof row.verifiedCountryEvidenceUrl !== 'string') return false;
  try {
    const url = new URL(row.verifiedCountryEvidenceUrl);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
