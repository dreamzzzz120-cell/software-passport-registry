import { GlassPanel } from './design/CommandCenter';

/**
 * The public sample Passport was intentionally removed.
 *
 * SPR must not present fabricated repository identities, evidence, hashes,
 * timestamps, counts, claims, or verification states as a product artifact.
 * Real Passport results are available through Free Review and authenticated
 * workspace flows, where the data is backed by observed evidence.
 */
export default function DemoPassport({ onRunFreeReview, onHome }: { onRunFreeReview: () => void; onHome: () => void }) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] px-6 py-16 text-[var(--spr-text)]">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={onHome}
          className="mb-8 text-sm text-[var(--spr-text-muted)] underline-offset-4 hover:text-[var(--spr-highlight)] hover:underline"
        >
          ← Back to Software Passport Registry
        </button>

        <GlassPanel raised className="p-8 md:p-10">
          <div className="text-[11px] font-bold uppercase tracking-[.2em] text-[var(--spr-amber)]">
            No sample data
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--spr-text)]">
            See a real Software Passport instead.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--spr-text-muted)]">
            SPR no longer displays a fabricated sample Passport. Repository names,
            commits, evidence, findings, timestamps, hashes and verification states
            should come from actual observations, not illustrative values.
          </p>

          <div className="mt-8 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-5">
            <h2 className="text-base font-semibold text-[var(--spr-text)]">What a real review can show</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--spr-text-muted)]">
              <li>• Repository and release identity actually observed by SPR</li>
              <li>• Evidence collected from supported sources</li>
              <li>• Components and vulnerability observations actually found</li>
              <li>• Verification states derived from the authoritative evaluator</li>
              <li>• UNKNOWN where the available evidence is insufficient</li>
            </ul>
          </div>

          <button
            onClick={onRunFreeReview}
            className="mt-8 rounded-[3px] bg-[var(--spr-accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--spr-accent-hover)]"
          >
            Run a Free Review
          </button>
        </GlassPanel>
      </div>
    </div>
  );
}
