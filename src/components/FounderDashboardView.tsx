import React, { useEffect, useState } from 'react';
import { ShieldCheck, Sparkles, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import FounderCommandCenterPanel from './FounderCommandCenterPanel';
import FounderMonitoringPanel from './FounderMonitoringPanel';
import FounderLeadsPanel from './FounderLeadsPanel';
import FounderInquiriesPanel from './FounderInquiriesPanel';
import FounderRegistryCrawlerPanel from './FounderRegistryCrawlerPanel';
import FounderTrafficPanel from './FounderTrafficPanel';
import FounderDistributionOpportunities from './FounderDistributionOpportunities';
import FounderGrowthHub from './FounderGrowthHub';
import FounderAgentsPanel from './FounderAgentsPanel';
import FounderOverview from './FounderOverview';
import FounderMissionControl from './FounderMissionControl';
import FounderFeatureControlMatrix from './FounderFeatureControlMatrix';

interface FounderDashboardViewProps { userRole: string; }

// The page used to stack nine panels open at once; most were empty most of
// the time and read as dead rows. Secondary panels now sit behind a header
// that opens on click, so the page is agents → connections → detail on demand.
function FounderSection({ title, hint, defaultOpen = false, children }: { title: string; hint: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left">
        <span><span className="text-sm font-semibold text-[var(--spr-text)]">{title}</span><span className="ml-2 text-xs text-[var(--spr-text-muted)]">{hint}</span></span>
        {open ? <ChevronDown className="w-4 h-4 text-[var(--spr-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--spr-text-muted)]" />}
      </button>
      {open && <div className="border-t border-[var(--spr-border)] px-5 pb-5 pt-1">{children}</div>}
    </section>
  );
}
interface SelfPassportSummary { id?: string; name?: string; version?: string; overallScore?: number; healthStatus?: string; releaseDate?: string; publisher?: string; scannedAt?: string; sbomComponentCount?: number | null; evidenceCount?: number; openFindings?: number; criticalOrHigh?: number; }

export default function FounderDashboardView({ userRole }: FounderDashboardViewProps) {
  const [passport, setPassport] = useState<SelfPassportSummary | null>(null);
  const [loadingPassport, setLoadingPassport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerAccess = userRole === 'Owner';

  // The self passport used to wait for a button click and sat empty until
  // then; it now loads with the page.
  useEffect(() => { if (ownerAccess) void fetchSelfPassport(); }, [ownerAccess]);

  const fetchSelfPassport = async () => {
    setLoadingPassport(true); setError(null);
    try {
      const response = await apiFetch('/api/passports/self-passport');
      const data = await response.json().catch(() => null);
      if (response.status === 404) { setPassport(null); return; }
      if (!response.ok) throw new Error(data?.error || `Self passport request failed (${response.status})`);
      setPassport({ id:data.id, name:data.name, version:data.version, overallScore:data.overallScore, healthStatus:data.healthStatus, releaseDate:data.releaseDate, publisher:data.publisher, scannedAt:data.scannedAt, sbomComponentCount:data.sbomComponentCount, evidenceCount:data.evidenceCount, openFindings:data.openFindings, criticalOrHigh:data.criticalOrHigh });
    } catch (err: any) { setError(err?.message || 'Unable to fetch SPR self passport.'); }
    finally { setLoadingPassport(false); }
  };

  if (!ownerAccess) return <div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-8 text-[var(--spr-text)]"><div className="flex items-center gap-3 mb-4"><ShieldCheck className="w-6 h-6 text-[var(--spr-red)]" /><div><h1 className="text-xl font-semibold">Founder Admin Access Required</h1><p className="text-sm text-[var(--spr-text-muted)]">You must be signed in as an Owner to view the Founder/Admin Control Center.</p></div></div><div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-surface)] p-6"><p className="text-sm text-[var(--spr-text-muted)]">This dashboard contains privileged SPR system telemetry, self-verification reports, and high-confidence executive controls. Please contact your administrator to request Owner role access.</p></div></div>;

  return <>
  <FounderMissionControl />
    <div className="space-y-8">
      <FounderOverview />
      <FounderFeatureControlMatrix />
    {error && <div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]">{error}</div>}
    <FounderAgentsPanel />
    <FounderCommandCenterPanel />
    <FounderSection title="Leads" hint="Free Review visitors who left an email">
      <FounderLeadsPanel />
    </FounderSection>
    <FounderSection title="Growth hub" hint="campaign settings, contacts and pipeline stages">
      <FounderGrowthHub />
    </FounderSection>
    <FounderSection title="Distribution opportunities" hint="highest-scoring researched companies">
      <FounderDistributionOpportunities />
    </FounderSection>
    <FounderSection title="Inquiries" hint="contact-form and feedback submissions">
      <FounderInquiriesPanel />
    </FounderSection>
    <FounderSection title="Traffic" hint="observed page events">
      <FounderTrafficPanel />
    </FounderSection>
    <FounderSection title="Monitoring" hint="trust monitoring runs">
      <FounderMonitoringPanel />
    </FounderSection>
    <FounderSection title="Registry crawler runs" hint="raw crawl history (also summarised under Agents)">
      <FounderRegistryCrawlerPanel />
    </FounderSection>
    <div>
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6"><div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4"><div><div className="inline-flex items-center gap-2 rounded-full bg-[var(--spr-accent-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--spr-highlight)]"><Sparkles className="w-4 h-4" /> Evidence-backed self passport</div><h2 className="mt-4 text-xl font-semibold text-[var(--spr-text)]">SPR Self Passport</h2><p className="mt-2 text-sm text-[var(--spr-text-muted)]">The newest completed scan of SPR's own repository in this workspace, read from the same tables every other passport uses. Nothing here is seeded or defaulted.</p></div><button onClick={fetchSelfPassport} disabled={loadingPassport} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className="w-4 h-4" />Refresh Passport</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Passport Name</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{passport?.name ?? 'Not verified'}</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Commit</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)] font-mono break-all">{passport?.version ? passport.version.slice(0, 12) : 'Not verified'}</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Health</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{passport?.healthStatus ?? 'Not verified'}</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Acquired</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{passport?.releaseDate ?? 'Not verified'}</p></div></div>{passport?.publisher && <div className="mt-6 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Publisher</span><p className="mt-2 text-base font-semibold text-[var(--spr-text)]">{passport.publisher}</p></div>}{passport && <div className="mt-6 grid gap-4 sm:grid-cols-4"><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">SBOM Components</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{typeof passport.sbomComponentCount === 'number' ? passport.sbomComponentCount : 'Not verified'}</p><p className="mt-1 text-[11px] text-[var(--spr-text-muted)]">Syft, from the scanned commit.</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Evidence Items</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{typeof passport.evidenceCount === 'number' ? passport.evidenceCount : 'Not verified'}</p><p className="mt-1 text-[11px] text-[var(--spr-text-muted)]">Persisted scanner responses.</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Open Findings</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{typeof passport.openFindings === 'number' ? passport.openFindings : 'Not verified'}</p><p className="mt-1 text-[11px] text-[var(--spr-text-muted)]">Not resolved, closed or verified.</p></div><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><span className="text-[12px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">Critical / High</span><p className="mt-2 text-lg font-semibold text-[var(--spr-text)]">{typeof passport.criticalOrHigh === 'number' ? passport.criticalOrHigh : 'Not verified'}</p><p className="mt-1 text-[11px] text-[var(--spr-text-muted)]">Of the open findings.</p></div></div>}{passport?.scannedAt && <p className="mt-4 text-[12px] text-[var(--spr-text-muted)]">Scanned {new Date(passport.scannedAt).toLocaleString()} · passport <span className="font-mono">{passport.id}</span></p>}{!loadingPassport && !passport && !error && <p className="mt-6 text-sm text-[var(--spr-text-muted)]">No completed scan of the SPR repository exists in this workspace yet. Run a repository scan of dreamzzzz120-cell/software-passport-registry from the Scans page; this card fills in from that scan and from nothing else.</p>}</div>
    </div>
  </div>
  </>;
}
