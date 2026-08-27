// Honest trust mark for SPR. Deliberately does NOT claim ISO/SOC2/GDPR
// certification unless/until those are actually held — see /areas/spr.md
// fabrication-audit history. Status reflects the real EvidenceStatus
// system (src/middleware/validation.ts), not a decorative seal.
import type { SVGProps } from 'react';

export type TrustBadgeStatus = 'verified' | 'partially_verified' | 'unverified';

const STATUS_COPY: Record<TrustBadgeStatus, { label: string; dot: string }> = {
  verified: { label: 'Evidence Verified', dot: 'var(--spr-green)' },
  partially_verified: { label: 'Partially Verified', dot: 'var(--spr-amber)' },
  unverified: { label: 'Unverified — Declared Only', dot: 'var(--spr-gray)' },
};

export default function TrustBadge({
  status = 'unverified',
  size = 96,
  ...rest
}: { status?: TrustBadgeStatus; size?: number } & SVGProps<SVGSVGElement>) {
  const copy = STATUS_COPY[status];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label={`SPR Software Passport — ${copy.label}`}
      {...rest}
    >
      <rect x="1" y="1" width="94" height="94" rx="6" fill="var(--spr-surface, #fff)" stroke="var(--spr-border, #e1dfdd)" />
      <rect x="1" y="1" width="94" height="24" rx="6" fill="var(--spr-surface-alt, #faf9f8)" stroke="var(--spr-border, #e1dfdd)" />
      <text x="48" y="17" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="10" fontWeight="600" letterSpacing="0.06em" fill="var(--spr-text-muted, #605e5c)">
        SOFTWARE PASSPORT
      </text>
      <text x="48" y="46" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="15" fontWeight="700" fill="var(--spr-text, #201f1e)">
        SPR
      </text>
      <circle cx="36" cy="66" r="4" fill={copy.dot} />
      <text x="44" y="69" fontFamily="Inter, system-ui, sans-serif" fontSize="9" fontWeight="600" fill="var(--spr-text, #201f1e)">
        {copy.label}
      </text>
      <text x="48" y="86" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="7" fill="var(--spr-text-faint, #8a8886)">
        Backed by recorded evidence, not self-attestation
      </text>
    </svg>
  );
}
