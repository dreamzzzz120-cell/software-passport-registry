import LegalFooterLinks from './legal/LegalFooterLinks';

interface Props {
  section: 'about' | 'methodology' | 'security' | 'trust';
  onNavigate: (path: string) => void;
}

const sections = [
  ['about', 'About SPR'],
  ['methodology', 'Methodology'],
  ['security', 'Security'],
  ['trust', 'Trust Center'],
] as const;

export default function PublicTrustCenterView({ section, onNavigate }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[var(--spr-text)]">
      <header className="border-b border-[var(--spr-border)] bg-[var(--spr-surface-deep)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <button onClick={() => onNavigate('/')} className="flex items-center gap-3 text-left">
            <img src="/brand/spr-icon.png" alt="SPR" className="h-9 w-9 rounded-md border border-[var(--spr-border)] bg-white object-contain p-1" />
            <div><div className="text-sm font-semibold">Software Passport Registry</div><div className="text-[10px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Independent software trust infrastructure</div></div>
          </button>
          <button onClick={() => onNavigate('/free-review')} className="rounded-[3px] bg-[var(--spr-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--spr-accent-hover)]">Run a Free Review</button>
        </div>
      </header>

      <nav className="border-b border-[var(--spr-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-6 py-3">
          {sections.map(([key, label]) => <button key={key} onClick={() => onNavigate(`/${key}`)} className={`rounded px-3 py-2 text-xs font-semibold ${section === key ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'}`}>{label}</button>)}
          <button onClick={() => onNavigate('/terms')} className="rounded px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Terms</button>
          <button onClick={() => onNavigate('/privacy')} className="rounded px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Privacy</button>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-14">
        {section === 'about' && <About onNavigate={onNavigate} />}
        {section === 'methodology' && <Methodology />}
        {section === 'security' && <Security />}
        {section === 'trust' && <Trust />}
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
    <div className="mt-10 rounded-md border border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/5 p-6"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-amber)]">Important distinction</div><p className="mt-2 text-sm leading-7 text-[var(--spr-text-muted)]">SPR is not affiliated with government passport services and is not the European Commission's Digital Product Passport registry. The term “passport” describes SPR's software evidence record.</p></div>
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

function Security() {
  return <div className="max-w-5xl"><Eyebrow>Security</Eyebrow><h1 className="mt-3 text-4xl font-semibold tracking-tight">Security and responsible operation.</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">SPR uses layered controls intended to protect customer workspaces and preserve evidence integrity. These controls do not constitute a security certification.</p><div className="mt-10 grid gap-5 md:grid-cols-2"><Card title="Access control">Authentication is provided through Firebase Authentication. Application authorization uses roles and tenant/client scoping.</Card><Card title="Evidence integrity">Material evidence and trust observations can be recorded with content hashes and timestamps so later reports can distinguish historical observations from current state.</Card><Card title="Application protection">The production stack uses HTTPS/TLS, security headers, rate limiting on sensitive endpoints, validation and server-side authorization checks.</Card><Card title="Monitoring">Application error monitoring can be enabled through Sentry. Operational health checks and deployment verification are used as part of production operation.</Card><Card title="Third-party providers">SPR relies on infrastructure and service providers for hosting, authentication, billing, source-code integrations and optional AI assistance. Provider use is disclosed in the Privacy Policy.</Card><Card title="What SPR does not claim">SPR does not claim SOC 2, ISO 27001, penetration-test certification, government approval or regulatory certification unless a specific claim is separately documented and current.</Card></div></div>;
}

function Trust() {
  return <div className="max-w-5xl"><Eyebrow>Trust Center</Eyebrow><h1 className="mt-3 text-4xl font-semibold tracking-tight">Verify SPR itself.</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">This page is designed for customers, MSPs, partners and investors who want to understand what SPR is, what it claims, and where its limits are.</p><div className="mt-10 overflow-hidden rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]"><Row label="Product" value="Software Passport Registry (SPR)" /><Row label="Purpose" value="Evidence-based software trust and governance infrastructure" /><Row label="Status" value="Early-stage independent software product" /><Row label="Certification status" value="No security or compliance certification is claimed here" /><Row label="Government affiliation" value="None claimed" /><Row label="Digital Product Passport registry" value="Not the European Commission registry" /><Row label="Evidence model" value="Observed evidence, verification, explainable trust state and limitations" /></div><div className="mt-8 grid gap-5 md:grid-cols-3"><Card title="Methodology">How evidence becomes a trust state.</Card><Card title="Security">Controls, limitations and third-party dependencies.</Card><Card title="Legal">Terms and Privacy are publicly available.</Card></div></div>;
}

function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">{children}</div>; }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-xs leading-6 text-[var(--spr-text-muted)]">{children}</p></section>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 border-b border-[var(--spr-border)] p-5 last:border-b-0 md:grid-cols-[220px_1fr]"><div className="text-xs font-semibold text-[var(--spr-text-muted)]">{label}</div><div className="text-sm">{value}</div></div>; }
