/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { GREEN } from '../../workflows/featureColors';
import type { TrustState } from './TrustStateBadge';

const NEUTRAL = 'var(--spr-text-faint)';
const BORDER = 'var(--spr-border)';

export interface TrustFieldDimension {
  key: string;
  label: string;
  /** A real, backend-computed value, or null when SPR has not measured this dimension. Never a placeholder number. */
  value: number | null;
}

interface TrustFieldProps {
  dimensions: TrustFieldDimension[];
  state: TrustState;
  centerLabel?: string;
  /** Marks the visualization as illustrative rather than a real Passport's data (required whenever no real backend record backs it -- see the honesty policy this component exists to uphold). */
  demo?: boolean;
  size?: number;
}

const STATE_COLOR: Record<TrustState, string> = {
  VERIFIED: GREEN,
  PARTIALLY_VERIFIED: 'var(--spr-amber)',
  EVIDENCE_INCOMPLETE: NEUTRAL,
  VERIFICATION_FAILED: 'var(--spr-red)',
  UNINITIALIZED: NEUTRAL,
};

// The signature SPR visualization: a Software Passport at the center with its
// real trust dimensions arranged around it. A dimension with value === null
// is rendered as an explicit, dashed "not available" node -- this component
// has no code path that invents a number. Pure SVG, no charting dependency,
// and the only animation is a slow center-node pulse gated on
// prefers-reduced-motion so it never becomes the sole carrier of information
// (every value is also present as plain text below the node).
export default function TrustField({ dimensions, state, centerLabel = 'PASSPORT', demo = false, size = 340 }: TrustFieldProps) {
  const radius = size * 0.36;
  const center = size / 2;
  const nodeRadius = Math.max(30, size * 0.09);

  const positioned = useMemo(() => dimensions.map((dimension, index) => {
    const angle = (index / dimensions.length) * Math.PI * 2 - Math.PI / 2;
    return { ...dimension, x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  }), [dimensions, center, radius]);

  const centerColor = STATE_COLOR[state];

  return (
    <div className="relative" role="img" aria-label={`Trust Field for ${centerLabel}: ${dimensions.map((d) => `${d.label} ${d.value === null ? 'not available' : d.value}`).join(', ')}`}>
      {demo && <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[.15em] text-[var(--spr-text-faint)]">Example data</span>}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
        {positioned.map((dimension) => (
          <line key={`line-${dimension.key}`} x1={center} y1={center} x2={dimension.x} y2={dimension.y} stroke={dimension.value === null ? BORDER : `${centerColor}55`} strokeWidth={1.5} strokeDasharray={dimension.value === null ? '3 4' : undefined} />
        ))}
        <circle cx={center} cy={center} r={nodeRadius * 1.15} fill="var(--spr-surface-deep)" stroke={centerColor} strokeWidth={2} className="trust-field-center" />
        <text x={center} y={center - 4} textAnchor="middle" fontSize={size * 0.032} fontWeight={700} fill="var(--spr-text)" fontFamily="ui-monospace, monospace">{centerLabel}</text>
        <text x={center} y={center + 14} textAnchor="middle" fontSize={size * 0.026} fill={centerColor} fontFamily="ui-monospace, monospace">{state.replace(/_/g, ' ')}</text>
        {positioned.map((dimension) => {
          const known = dimension.value !== null;
          const color = known ? centerColor : NEUTRAL;
          return (
            <g key={dimension.key}>
              <circle cx={dimension.x} cy={dimension.y} r={nodeRadius} fill="var(--spr-surface)" stroke={color} strokeWidth={known ? 1.5 : 1} strokeDasharray={known ? undefined : '3 3'} />
              <text x={dimension.x} y={dimension.y - 3} textAnchor="middle" fontSize={size * 0.028} fontWeight={700} fill={known ? 'var(--spr-text)' : NEUTRAL} fontFamily="ui-monospace, monospace">{known ? dimension.value : 'N/A'}</text>
              <text x={dimension.x} y={dimension.y + size * 0.045} textAnchor="middle" fontSize={size * 0.023} fill={NEUTRAL} className="uppercase tracking-wide">{dimension.label}</text>
            </g>
          );
        })}
      </svg>
      {/* Textual fallback so no state depends solely on the SVG. */}
      <ul className="sr-only">
        {dimensions.map((dimension) => <li key={dimension.key}>{dimension.label}: {dimension.value === null ? 'Not available' : dimension.value}</li>)}
      </ul>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .trust-field-center { animation: spr-trust-pulse 3.5s ease-in-out infinite; }
        }
        @keyframes spr-trust-pulse {
          0%, 100% { filter: drop-shadow(0 0 0px ${centerColor}); }
          50% { filter: drop-shadow(0 0 6px ${centerColor}88); }
        }
      `}</style>
    </div>
  );
}
