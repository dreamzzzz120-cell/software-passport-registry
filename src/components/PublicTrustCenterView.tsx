import { useEffect, useState, type FormEvent } from 'react';
import LegalFooterLinks from './legal/LegalFooterLinks';
import { apiFetch } from '../utils/apiClient';
import { SUBPROCESSORS, SUBPROCESSORS_LAST_UPDATED, type Subprocessor } from '../legal/subprocessors';

export type PublicSection = 'about' | 'methodology' | 'security' | 'trust' | 'contact' | 'data-retention' | 'subprocessors';

interface Props {
  section: PublicSection;
  onNavigate: (path: string) => void;
}

const sections: ReadonlyArray<readonly [PublicSection, string, string]> = [
  ['about', 'About SPR', '/about/'],
  ['methodology', 'Methodology', '/methodology/'],
  ['security', 'Security', '/security/'],
  ['trust', 'Trust Center', '/trust/'],
  ['data-retention', 'Data retention', '/data-retention/'],
  ['subprocessors', 'Subprocessors', '/subprocessors/'],
  ['contact', 'Contact', '/contact/'],
];

export default function PublicTrustCenterView({ section, onNavigate }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[var(--spr-text)]">
      <header className="border-b border-[var(--spr-border)] bg-[var(--spr-surface-deep)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <button onClick={() => onNavigate('/')} className="flex items-center gap-3 text-left">
            <img src="/brand/spr-icon.png" alt="SPR" className="h-11 w-11 rounded-md border border-[var(--spr-border)] object-contain" />
            <div><div className="text-sm font-semibold">Software Passport Registry</div><div className="text-[12px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Independent software trust infrastructure</div></div>
          </button>
          <button onClick={() => onNavigate('/free-review')} className="rounded-[3px] bg-[var(--spr-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--spr-accent-hover)]">Run a Free Review</button>
        </div>
      </header>

      <nav className="border-b border-[var(--spr-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-6 py-3">
          {sections.map(([key, label, path]) => <button key={key} onClick={() => onNavigate(path)} className={`rounded px-3 py-2 text-xs font-semibold ${section === key ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'}`}>{label}</button>)}
          <button onClick={() => onNavigate('/dpa')} className="rounded px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">DPA</button>
          <button onClick={() => onNavigate('/terms')} className="rounded px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Terms</button>
          <button onClick={() => onNavigate('/privacy')} className="rounded px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Privacy</button>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-14">
        {section === 'about' && <About onNavigate={onNavigate} />}
        {section === 'methodology' && <Methodology />}
        {section === 'security' && <Security onNavigate={onNavigate} />}
        {section === 'trust' && <Trust />}
        {section === 'contact' && <Contact />}
        {section === 'data-retention' && <DataRetention onNavigate={onNavigate} />}
        {section === 'subprocessors' && <Subprocessors onNavigate={onNavigate} />}
      </main>

      <footer className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="text-sm font-semibold">Software Passport Registry (SPR)</div>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-[var(--spr-text-muted)]">An independent software trust and evidence platform. SPR evaluates available evidence; it does not issue government credentials or security certifications.</p>
          <LegalFooterLinks className="mt-5" />
        </div>
      </footer>
    </div>
  );
}

function About({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <div className="max-w-4xl">
    <Eyebrow>About Software Passport Registry</Eyebrow>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">A trust layer for software decisions.</h1>
    <p className="mt-6 text-base leading-8 text-[var(--spr-text-muted)]">Software Passport Registry (SPR) is an independent software trust and evidence platform. It helps buyers, security teams, procurement teams, MSPs and software owners understand what available evidence says about a software asset.</p>
    <div className="mt-10 grid gap-5 md:grid-cols-2">
      <Card title="What SPR does">SPR organizes software identity, security signals, dependencies, provenance, reliability indicators and other evidence into an explainable record.</Card>
      <Card title="What SPR does not do">SPR does not guarantee that software is safe, issue government credentials, or represent that a score is a security, legal or regulatory certification.</Card>
      <Card title="What a Software Passport is">A Software Passport is a dated evidence record for a software asset. It records what was observed, what was independently verified, what remains unknown, and the resulting trust state.</Card>
      <Card title="Who operates it">SPR is an early-stage independent software product. Public company/legal information is intentionally limited to facts that have been verified; no invented corporate registration, certification or partnership claims are presented.</Card>
    </div>
    <div className="mt-10 rounded-md border border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/5 p-6"><div className="text-[12px] font-bold uppercase tracking-[.18em] text-[var(--spr-amber)]">Important distinction</div><p className="mt-2 text-sm leading-7 text-[var(--spr-text-muted)]">SPR is not affiliated with government passport services and is not the European Commission's Digital Product Passport registry. The term “passport” describes SPR's software evidence record.</p></div>
    <button onClick={() => onNavigate('/passport/demo')} className="mt-8 rounded-[3px] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-5 py-3 text-sm font-semibold hover:bg-[var(--spr-surface-hover)]">View a sample Software Passport →</button>
  </div>;
}

function Methodology() {
  const steps = [
    ['01', 'Identify', 'Establish the software asset, version, publisher and other available identity signals.'],
    ['02', 'Collect evidence', 'Gather observable inputs such as SBOMs, vulnerability results, repository signals, attestations and supplied documents.'],
    ['03', 'Verify', 'Where verification is available, re-check the claim or source. Self-reported information is not automatically treated as independent evidence.'],
    ['04', 'Assess', 'Map available evidence to trust dimensions and produce explainable findings and reason codes.'],
    ['05', 'Observe again', 'Trust is time-dependent. New observations can change the current state without silently rewriting historical records.'],
  ];
  return <div className="max-w-5xl"><Eyebrow>Methodology</Eyebrow><h1 className="mt-3 text-4xl font-semibold tracking-tight">Evidence → verification → trust state.</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">SPR is designed to keep evidence, interpretation and conclusions separate. Missing evidence remains visible as unknown rather than being converted into certainty.</p><div className="mt-10 grid gap-4 md:grid-cols-5">{steps.map(([n, title, body]) => <Card key={n} title={`${n} · ${title}`}>{body}</Card>)}</div><div className="mt-10 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><h2 className="text-lg font-semibold">Scoring principles</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--spr-text-muted)]"><li>Observed evidence is distinguished from assumptions.</li><li>Repeated observations from one source are not treated as independent corroboration.</li><li>Scores are snapshots, not permanent guarantees.</li><li>UNKNOWN is a valid state when evidence is insufficient.</li><li>Reports should expose limitations and supporting evidence.</li></ul></div></div>;
}

function Security({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <div className="max-w-5xl">
    <Eyebrow>Security</Eyebrow>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">Security architecture and responsible operation.</h1>
    <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">The controls below are the ones implemented in the running service. They are described so a buyer can check them, not as a certification: SPR holds no SOC 2, ISO 27001 or penetration-test attestation, and says so.</p>
    <div className="mt-10 grid gap-5 md:grid-cols-2">
      <Card title="Tenant isolation">Every tenant-scoped table is protected by PostgreSQL row-level security. The API connects with a least-privilege runtime role and binds the tenant context to each request's transaction, so one workspace cannot read another's rows even through a bug in application code. The deployment's readiness probe asserts that RLS is enforced and fails closed if it is not.</Card>
      <Card title="Authentication">Firebase Authentication issues sign-in tokens; the API verifies every ID token server-side with revocation checking. Email verification is required before workspace access. Multi-factor authentication can be enrolled per account.</Card>
      <Card title="Authorization">Roles (Owner, Admin, Technician, Viewer, Client) are enforced on the server for each route. Client-role accounts are scoped to one client record. Founder-only operations are gated by an explicit allow-list, separate from the Owner role.</Card>
      <Card title="Secrets and credentials">Integration credentials are encrypted with a dedicated key before storage and are never returned to the browser. Public passport links are signed, time-limited tokens that expose observed evidence only, never the authoritative score.</Card>
      <Card title="Evidence integrity">An append-only, hash-chained audit trail records security-relevant actions and can be verified on demand. Evidence records carry content hashes and timestamps so later reports distinguish historical observations from current state.</Card>
      <Card title="Transport and browser hardening">HTTPS with HTTP Strict Transport Security on every endpoint; TLS to the database and to every third-party API; Content Security Policy, frame denial, MIME-sniffing protection, referrer and permissions policies on every response.</Card>
      <Card title="Abuse controls">Rate limiting on every API route backed by a shared store that fails closed; request-body size limits; schema validation on every write; honeypot and per-address limits on public forms.</Card>
      <Card title="AI boundaries">Where AI is enabled, it receives a read-only evidence snapshot and its output is rejected unless every claim cites evidence that was actually supplied. AI can never write evidence, findings, scores or remediation state.</Card>
      <Card title="Operations">Dependency vulnerability scanning and pinned CI actions on every change; error monitoring on the API and worker; migrations run before each deployment and health checks gate traffic.</Card>
      <Card title="Responsible disclosure">Report a vulnerability to <a className="text-[var(--spr-highlight)] hover:underline" href="mailto:security@softwarepassportregistry.com">security@softwarepassportregistry.com</a> or through the <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/contact/')}>contact form</button> with the “Security report” topic. We acknowledge reports and do not pursue good-faith researchers. See <a className="text-[var(--spr-highlight)] hover:underline" href="https://github.com/dreamzzzz120-cell/software-passport-registry/blob/main/SECURITY.md" rel="noreferrer">SECURITY.md</a>.</Card>
    </div>
    <div className="mt-8 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><h2 className="text-lg font-semibold">What SPR does not claim</h2><p className="mt-2 text-sm leading-7 text-[var(--spr-text-muted)]">SPR does not claim SOC 2, ISO 27001, penetration-test certification, government approval or regulatory certification. The <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/dpa')}>Data Processing Agreement</button> lists the same controls as contractual commitments, and the <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/subprocessors/')}>subprocessor list</button> shows which third parties are engaged and which optional ones are configured right now.</p></div>
  </div>;
}

function Trust() {
  return <div className="max-w-5xl"><Eyebrow>Trust Center</Eyebrow><h1 className="mt-3 text-4xl font-semibold tracking-tight">Verify SPR itself.</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">This page is designed for customers, MSPs, partners and investors who want to understand what SPR is, what it claims, and where its limits are.</p><div className="mt-10 overflow-hidden rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]"><Row label="Product" value="Software Passport Registry (SPR)" /><Row label="Purpose" value="Evidence-based software trust and governance infrastructure" /><Row label="Status" value="Early-stage independent software product" /><Row label="Certification status" value="No security or compliance certification is claimed here" /><Row label="Government affiliation" value="None claimed" /><Row label="Digital Product Passport registry" value="Not the European Commission registry" /><Row label="Evidence model" value="Observed evidence, verification, explainable trust state and limitations" /></div><div className="mt-8 grid gap-5 md:grid-cols-3"><Card title="Methodology">How evidence becomes a trust state.</Card><Card title="Security">Controls, limitations and third-party dependencies.</Card><Card title="Legal">Terms, Privacy and the Data Processing Agreement are publicly available.</Card></div></div>;
}

const CONTACT_TOPICS: Array<{ id: string; label: string }> = [
  { id: 'product', label: 'Product question' },
  { id: 'msp_pilot', label: 'MSP pilot' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'security', label: 'Security report' },
  { id: 'privacy', label: 'Privacy or data request' },
  { id: 'other', label: 'Something else' },
];

function Contact() {
  const [form, setForm] = useState({ name: '', email: '', company: '', topic: 'product', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string; forwarded: boolean } | null>(null);
  const update = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/public/contact', { method: 'POST', body: JSON.stringify({ ...form, company: form.company || undefined, website: form.website || undefined }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.error || `The message could not be sent (HTTP ${response.status}).`); return; }
      setResult({ id: data.id, forwarded: data.forwarded === true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally { setBusy(false); }
  };

  return <div className="max-w-4xl">
    <Eyebrow>Contact</Eyebrow>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">Talk to Software Passport Registry.</h1>
    <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">Product questions, security reports, partnership discussions, MSP pilots and privacy requests all come through the same form. Every message is stored and forwarded to the team; the confirmation below tells you exactly which of those happened.</p>
    <div className="mt-10 grid gap-8 md:grid-cols-[1fr_280px]">
      {result ? (
        <div className="rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/5 p-6 text-sm leading-7">
          <div className="font-semibold">Message recorded.</div>
          <p className="mt-1 text-[var(--spr-text-muted)]">Reference <code className="text-[var(--spr-text)]">{result.id}</code>. {result.forwarded ? 'It was forwarded to the team by email; expect a reply to the address you gave.' : 'It is stored, but the email forward did not go through, so it may take longer to be seen. If it is urgent, email contact@softwarepassportregistry.com directly and quote the reference.'}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Your name"><input required minLength={2} maxLength={120} value={form.name} onChange={update('name')} className={inputClass} autoComplete="name" /></Field>
            <Field label="Work email"><input required type="email" maxLength={254} value={form.email} onChange={update('email')} className={inputClass} autoComplete="email" /></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company (optional)"><input maxLength={160} value={form.company} onChange={update('company')} className={inputClass} autoComplete="organization" /></Field>
            <Field label="Topic"><select value={form.topic} onChange={update('topic')} className={inputClass}>{CONTACT_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
          </div>
          <Field label="Message"><textarea required minLength={10} maxLength={4000} rows={7} value={form.message} onChange={update('message')} className={inputClass} /></Field>
          <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={update('website')} /></label></div>
          {error && <div className="rounded border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/5 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
          <button type="submit" disabled={busy} className="rounded-[3px] bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-60">{busy ? 'Sending…' : 'Send message'}</button>
          <p className="text-[11px] leading-5 text-[var(--spr-text-faint)]">Your message, name, email and a hashed form of your IP address are stored so we can reply and detect abuse. See the <a href="/privacy" className="text-[var(--spr-highlight)] hover:underline">Privacy Policy</a>.</p>
        </form>
      )}
      <aside className="space-y-4 text-sm leading-6 text-[var(--spr-text-muted)]">
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--spr-text-faint)]">Email</div><a className="text-[var(--spr-highlight)] hover:underline" href="mailto:contact@softwarepassportregistry.com">contact@softwarepassportregistry.com</a></div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--spr-text-faint)]">Security reports</div><a className="text-[var(--spr-highlight)] hover:underline" href="mailto:security@softwarepassportregistry.com">security@softwarepassportregistry.com</a></div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--spr-text-faint)]">Company</div>Software Passport Registry Ltd.<br />British Columbia, Canada</div>
      </aside>
    </div>
  </div>;
}

function DataRetention({ onNavigate }: { onNavigate: (path: string) => void }) {
  const rows: Array<[string, string, string]> = [
    ['Account and workspace records', 'users, roles, tenant settings, branding', 'Kept while the workspace exists. Deleted atomically by Owner-initiated Tenant Offboarding, which also removes the workspace’s sign-in accounts from the identity provider.'],
    ['Clients, passports, evidence, findings, scans', 'the evidence ledger and everything derived from it', 'Kept while the workspace exists so that historical observations remain auditable. Deleted by Tenant Offboarding. Files uploaded through Universal Intake are marked deleted after the workspace’s evidence retention period (default 730 days, Owner-configurable, minimum 30).'],
    ['Audit trail', 'hash-chained record of security-relevant actions', 'Kept while the workspace exists; the chain is append-only and not edited. Billing audit events are purged after the workspace’s audit retention period (default 2,555 days, minimum 30).'],
    ['Notification queue', 'emails and in-app notices the worker sends', 'Purged after the workspace’s notification retention period (default 180 days, minimum 30).'],
    ['Free Review and public registry', 'reviews of public GitHub repositories', 'Held in a system workspace, not a customer workspace. Results describe public source code at a specific commit and are kept to serve the public registry; a maintainer can ask for a page to be removed through the contact form.'],
    ['Contact-form messages', 'name, email, company, message, hashed IP', 'Kept until answered and then for up to 12 months for follow-up, after which they are deleted on request or in periodic clean-up.'],
    ['Billing records', 'subscriptions, invoices, payment status', 'Held by Stripe under its own retention rules and by SPR as billing audit events (above). Payment card details never reach SPR.'],
    ['Access logs and error reports', 'request metadata, stack traces', 'Hosting and monitoring providers retain these under their own schedules (see Subprocessors); SPR does not extend them.'],
  ];
  return <div className="max-w-5xl">
    <Eyebrow>Data retention and deletion</Eyebrow>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">What is kept, for how long, and how it is deleted.</h1>
    <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">These are the retention behaviours implemented in the running service. Periods marked Owner-configurable are set per workspace under Settings → Commercial → Retention and enforced by a scheduled worker; everything else is deleted through the actions described.</p>
    <div className="mt-10 overflow-x-auto rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-[var(--spr-border)] text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]"><th className="p-4">Data</th><th className="p-4">Contains</th><th className="p-4">Retention and deletion</th></tr></thead>
        <tbody>{rows.map(([a, b, c]) => <tr key={a} className="border-b border-[var(--spr-border)] align-top last:border-b-0"><td className="p-4 font-semibold">{a}</td><td className="p-4 text-[var(--spr-text-muted)]">{b}</td><td className="p-4 leading-6 text-[var(--spr-text-muted)]">{c}</td></tr>)}</tbody>
      </table>
    </div>
    <div className="mt-8 grid gap-5 md:grid-cols-2">
      <Card title="Deleting a workspace">A workspace Owner can delete everything from Settings → Tenant Offboarding. The purge runs as one database transaction across every tenant-scoped table, then the workspace’s sign-in accounts are removed. It is immediate and irreversible; export first.</Card>
      <Card title="Backups">The hosting provider’s database backups are overwritten in the ordinary rotation. Deleted data is not restored from backup except to recover from a service failure, in which case the deletion is re-applied.</Card>
      <Card title="Individual requests">Access, correction and deletion requests for personal data can be made through the <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/contact/')}>contact form</button> (topic: Privacy or data request). Requests relating to a customer workspace are referred to that workspace’s Owner, as the <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/dpa')}>DPA</button> requires.</Card>
      <Card title="Where data lives">All workspace data is stored with the providers listed on the <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/subprocessors/')}>Subprocessors</button> page, in the regions stated there.</Card>
    </div>
  </div>;
}

function Subprocessors({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [live, setLive] = useState<Array<Subprocessor & { configured: boolean }> | null>(null);
  const [liveError, setLiveError] = useState('');
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/public/subprocessors').then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!cancelled) setLive(data.subprocessors);
    }).catch((err) => { if (!cancelled) setLiveError(err instanceof Error ? err.message : 'unavailable'); });
    return () => { cancelled = true; };
  }, []);
  const list: Array<Subprocessor & { configured: boolean | null }> = live ?? SUBPROCESSORS.map((s) => ({ ...s, configured: s.optional ? null : true }));
  return <div className="max-w-5xl">
    <Eyebrow>Subprocessors and infrastructure</Eyebrow>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">Who processes data on SPR’s behalf.</h1>
    <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">Every provider the running service calls, what it is used for and what it sees. Providers marked optional are engaged only when a credential is configured; the “configured now” column is read live from the deployment, not assumed. Last reviewed {SUBPROCESSORS_LAST_UPDATED}.</p>
    {liveError && <p className="mt-3 text-xs text-[var(--spr-amber)]">Live configuration status could not be read ({liveError}); the list below is the documented one and optional providers are shown as “not verified”.</p>}
    <div className="mt-10 overflow-x-auto rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-[var(--spr-border)] text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]"><th className="p-4">Provider</th><th className="p-4">Purpose</th><th className="p-4">Data processed</th><th className="p-4">Location</th><th className="p-4">Configured now</th></tr></thead>
        <tbody>{list.map((s) => <tr key={s.id} className="border-b border-[var(--spr-border)] align-top last:border-b-0">
          <td className="p-4"><div className="font-semibold">{s.name}</div><div className="text-xs text-[var(--spr-text-faint)]">{s.legalEntity}</div></td>
          <td className="p-4 leading-6 text-[var(--spr-text-muted)]">{s.purpose}</td>
          <td className="p-4 leading-6 text-[var(--spr-text-muted)]">{s.dataProcessed}</td>
          <td className="p-4 text-[var(--spr-text-muted)]">{s.location}</td>
          <td className="p-4">{!s.optional ? <span className="text-[var(--spr-green)]">Always</span> : s.configured === null ? <span className="text-[var(--spr-text-faint)]">Not verified</span> : s.configured ? <span className="text-[var(--spr-green)]">Yes</span> : <span className="text-[var(--spr-text-faint)]">No ({s.enabledBy} unset)</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-8 grid gap-5 md:grid-cols-2">
      <Card title="Customer-connected integrations are not subprocessors">GitHub, GitLab, Bitbucket, Azure DevOps, Jira, Confluence, Slack, Microsoft 365, AWS, Azure, ConnectWise, Autotask, NinjaOne and Hudu connections are made with credentials the customer supplies and act on the customer’s own accounts; SPR reads from them on the customer’s instruction.</Card>
      <Card title="Changes">Additions or replacements are published here at least 30 days before they take effect, and workspace Owners with an executed <button className="text-[var(--spr-highlight)] hover:underline" onClick={() => onNavigate('/dpa')}>DPA</button> are notified by email, as the DPA requires.</Card>
    </div>
  </div>;
}

const inputClass = 'w-full rounded-[3px] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)] focus:border-[var(--spr-highlight)] focus:outline-none';
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-[var(--spr-text-muted)]"><span className="mb-1 block">{label}</span>{children}</label>; }
function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">{children}</div>; }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-xs leading-6 text-[var(--spr-text-muted)]">{children}</p></section>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 border-b border-[var(--spr-border)] p-5 last:border-b-0 md:grid-cols-[220px_1fr]"><div className="text-xs font-semibold text-[var(--spr-text-muted)]">{label}</div><div className="text-sm">{value}</div></div>; }
