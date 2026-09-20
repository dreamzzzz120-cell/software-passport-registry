/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — the expanded view behind a connection card.
// Everything shown is either (a) the live probe result for that connection,
// (b) the server's report of which settings are present (names only), or
// (c) static guidance. The "brief for your agent" is a text the founder
// copies to an operator or agent; this page does not perform the steps.

import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, XCircle } from 'lucide-react';

export type Connection = { key: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; lastChecked: string };
export type ConnectionSetting = { name: string; secret: boolean; set: boolean; purpose: string; whereToGet: string };
export type ConnectionGuide = {
  key: string;
  name: string;
  purpose: string;
  probe: string;
  statusMeaning: Record<Connection['status'], string>;
  configuredAt: string;
  steps: string[];
  settings: ConnectionSetting[];
};

const STATUS_LABEL: Record<Connection['status'], string> = { ok: 'Connected', error: 'Error', not_configured: 'Not configured' };

export function buildAgentBrief(connection: Connection, guide: ConnectionGuide): string {
  const missing = guide.settings.filter((s) => !s.set);
  const present = guide.settings.filter((s) => s.set);
  const lines = [
    `Task: make the "${guide.name}" connection on SPR's Founder Command Center report "Connected".`,
    '',
    `Observed now (${connection.lastChecked}): status=${connection.status}; detail="${connection.detail}".`,
    `Meaning: ${guide.statusMeaning[connection.status]}`,
    '',
    `What the check does: ${guide.probe}`,
    `Where the settings live: ${guide.configuredAt}`,
    '',
    `Settings already present (names only): ${present.length ? present.map((s) => s.name).join(', ') : 'none'}.`,
    `Settings missing: ${missing.length ? missing.map((s) => `${s.name} (${s.secret ? 'secret' : 'not secret'}; get it at: ${s.whereToGet})`).join('; ') : 'none'}.`,
    '',
    'Steps:',
    ...guide.steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    'Done when: after the service redeploys, GET /api/founder/command-center (as the founder) shows this connection with status "ok", and the Founder page card reads the same. Report the exact detail text observed; do not report success from configuration alone.',
    'Rules: never paste secret values into chat, tickets or source control; set them only in the platform variable store named above.',
  ];
  return lines.join('\n');
}

export default function FounderConnectionDetail({ connection, guide, onRecheck }: { connection: Connection; guide: ConnectionGuide; onRecheck: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const brief = buildAgentBrief(connection, guide);
  const missing = guide.settings.filter((s) => !s.set);

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 2500);
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 space-y-5" data-testid={`connection-detail-${guide.key}`}>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Observed status</p>
        <p className="mt-1 text-sm text-[var(--spr-text)]"><span className="font-semibold">{STATUS_LABEL[connection.status]}</span> — {connection.detail}</p>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Checked {new Date(connection.lastChecked).toLocaleString()}. {guide.statusMeaning[connection.status]}</p>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">What it is</p>
        <p className="mt-1 text-sm text-[var(--spr-text)]">{guide.purpose}</p>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]"><span className="font-semibold">How it is checked:</span> {guide.probe}</p>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Settings ({guide.settings.length - missing.length} of {guide.settings.length} set)</p>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Configured at: {guide.configuredAt}. Values are never shown here; only whether each one is present on the running API service.</p>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-[12px] uppercase tracking-[0.18em] text-[var(--spr-text-muted)]">
              <th className="pb-1 pr-3">Variable</th><th className="pb-1 pr-3">Present</th><th className="pb-1 pr-3">Purpose</th><th className="pb-1">Where to get it</th>
            </tr>
          </thead>
          <tbody>
            {guide.settings.map((s) => (
              <tr key={s.name} className="border-t border-[var(--spr-border)] align-top">
                <td className="py-1.5 pr-3 font-mono text-xs text-[var(--spr-text)]">{s.name}{s.secret && <span className="ml-1 rounded border border-[var(--spr-border)] px-1 text-[10px] uppercase text-[var(--spr-text-muted)]">secret</span>}</td>
                <td className="py-1.5 pr-3">{s.set ? <span className="inline-flex items-center gap-1 text-[var(--spr-green)]"><CheckCircle2 className="w-3.5 h-3.5" /> set</span> : <span className="inline-flex items-center gap-1 text-[var(--spr-red)]"><XCircle className="w-3.5 h-3.5" /> missing</span>}</td>
                <td className="py-1.5 pr-3 text-[var(--spr-text)]">{s.purpose}</td>
                <td className="py-1.5 text-[var(--spr-text-muted)]">{s.whereToGet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">How to configure it</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-[var(--spr-text)]">
          {guide.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Hand this to your agent</p>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]">A complete brief with the observed status, the exact missing settings and the steps above. Copy it into Claude Code (or whoever operates the platforms for you). This page only produces the brief; it does not change any platform itself.</p>
        <textarea readOnly value={brief} rows={8} className="mt-2 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-2 font-mono text-[11px] text-[var(--spr-text)]" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copyBrief()} className="spr-btn spr-btn-primary inline-flex items-center gap-2 text-xs"><Copy className="w-3.5 h-3.5" />{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed — select the text above' : 'Copy brief'}</button>
          <button type="button" onClick={onRecheck} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs"><ExternalLink className="w-3.5 h-3.5" />Re-check now</button>
        </div>
      </section>
    </div>
  );
}
