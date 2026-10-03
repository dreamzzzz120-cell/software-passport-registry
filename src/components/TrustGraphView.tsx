import { useMemo, useState } from 'react';
import { ArrowRight, CircleHelp, FileCheck2, Fingerprint, GitBranch, Search, ShieldCheck, X } from 'lucide-react';
import type { Client, EvidenceItem, SoftwarePassport } from '../types';

type GraphAsset = { id: string; name?: string; hostName?: string; type?: string; clientId?: string; clientName?: string; version?: string };
type GraphFinding = {
  id?: string;
  title?: string;
  control_id?: string;
  passport_id?: string;
  passportId?: string;
  evidence_id?: string;
  evidenceId?: string;
  evidence_ids?: string[];
  evidenceIds?: string[];
  verification_id?: string;
  verificationId?: string;
  verification_ids?: string[];
  verificationIds?: string[];
  client_id?: string;
  severity?: string;
  status?: string;
  description?: string;
};
type Stage = 'passport' | 'identity' | 'evidence' | 'finding' | 'verification';
type LineageNode = {
  id: string;
  stage: Stage;
  label: string;
  detail: string;
  meta?: string;
  passportId?: string;
  evidenceId?: string;
  findingId?: string;
  verificationId?: string;
};
type LineageEdge = {
  source: string;
  target: string;
  label: string;
  proof: string;
};

interface TrustGraphViewProps {
  clients?: Client[];
  passports?: SoftwarePassport[];
  assets?: GraphAsset[];
  findings?: unknown[];
}

const STAGES: Stage[] = ['passport', 'identity', 'evidence', 'finding', 'verification'];
const STAGE_META: Record<Stage, { label: string; description: string; icon: typeof Fingerprint }> = {
  passport: { label: 'Launch Ticket', description: 'The persisted evidence-backed software record.', icon: FileCheck2 },
  identity: { label: 'Software Identity', description: 'Only an explicitly persisted identity is shown.', icon: Fingerprint },
  evidence: { label: 'Evidence', description: 'Observed or declared evidence attached to the passport or identity.', icon: GitBranch },
  finding: { label: 'Findings', description: 'Findings with an explicit passport or evidence reference.', icon: CircleHelp },
  verification: { label: 'Verification', description: 'The recorded verification decision/status.', icon: ShieldCheck },
};

const STAGE_CLASS: Record<Stage, string> = {
  passport: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  identity: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  evidence: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  finding: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  verification: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
};

function text(value: unknown, fallback = 'Unavailable') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function short(value: unknown, fallback: string, length = 48) {
  const result = text(value, fallback);
  return result.length > length ? `${result.slice(0, length - 1)}…` : result;
}

function explicitIdentity(passport: SoftwarePassport & Record<string, unknown>) {
  const identity = passport.softwareIdentity ?? passport.identity;
  const identityId = text(passport.softwareIdentityId ?? passport.identityId, '');
  if (!identity && !identityId) return null;
  if (identity && typeof identity === 'object') {
    const record = identity as Record<string, unknown>;
    return {
      id: identityId || text(record.id, ''),
      label: text(record.name ?? record.canonicalName, passport.name),
      version: text(record.version, passport.version),
      detail: text(record.canonicalId ?? record.purl ?? record.ecosystem, 'Explicit software identity record'),
      meta: text(record.source ?? record.provider, ''),
    };
  }
  return { id: identityId, label: passport.name, version: passport.version, detail: 'Explicit software identity reference', meta: '' };
}

function referenceList(value: unknown): string[] {
  if (!Array.isArray(value)) return value == null ? [] : [String(value)];
  return value.map(String).filter(Boolean);
}

function evidenceIdentityRef(item: EvidenceItem & Record<string, unknown>) {
  return text(item.softwareIdentityId ?? item.identityId, '');
}

function evidencePassportRef(item: EvidenceItem & Record<string, unknown>) {
  return text(item.passportId, '');
}

function findingEvidenceRefs(finding: GraphFinding) {
  return [
    ...referenceList(finding.evidence_id),
    ...referenceList(finding.evidenceId),
    ...referenceList(finding.evidence_ids),
    ...referenceList(finding.evidenceIds),
  ];
}

function findingVerificationRefs(finding: GraphFinding) {
  return [
    ...referenceList(finding.verification_id),
    ...referenceList(finding.verificationId),
    ...referenceList(finding.verification_ids),
    ...referenceList(finding.verificationIds),
  ];
}

function edgeKey(edge: LineageEdge) {
  return `${edge.source}::${edge.target}::${edge.label}`;
}

export default function TrustGraphView({ passports = [], findings = [] }: TrustGraphViewProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<LineageEdge | null>(null);

  const { nodes, edges, counts } = useMemo(() => {
    const graphNodes: LineageNode[] = [];
    const graphEdges: LineageEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    const addNode = (node: LineageNode) => {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        graphNodes.push(node);
      }
    };
    const addEdge = (edge: LineageEdge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) return;
      const key = edgeKey(edge);
      if (edgeIds.has(key)) return;
      edgeIds.add(key);
      graphEdges.push(edge);
    };

    const passportIdentityIds = new Map<string, string>();
    const evidenceNodeByRawId = new Map<string, string>();
    const evidenceNodesByRawId = new Map<string, string[]>();
    const verificationNodeByRawId = new Map<string, string>();

    passports.forEach((rawPassport) => {
      const passport = rawPassport as SoftwarePassport & Record<string, unknown>;
      const passportId = `passport:${passport.id}`;
      addNode({
        id: passportId,
        stage: 'passport',
        label: short(passport.name, 'Launch Ticket'),
        detail: `${text(passport.version, 'Version unavailable')} · ${text(passport.publisher, 'Publisher unavailable')}`,
        meta: [passport.fileHash && `hash ${String(passport.fileHash)}`, passport.category && String(passport.category)].filter(Boolean).join(' · ') || undefined,
        passportId: passport.id,
      });

      const identity = explicitIdentity(passport);
      if (identity?.id) {
        const identityNodeId = `identity:${identity.id}`;
        passportIdentityIds.set(passport.id, identityNodeId);
        addNode({
          id: identityNodeId,
          stage: 'identity',
          label: short(identity.label, 'Software Identity'),
          detail: `${identity.version} · ${identity.detail}`,
          meta: identity.meta || undefined,
          passportId: passport.id,
        });
        addEdge({
          source: passportId,
          target: identityNodeId,
          label: 'identifies',
          proof: 'The Launch Ticket contains an explicit software identity reference.',
        });
      }

      (Array.isArray(passport.evidence) ? passport.evidence : []).forEach((rawEvidence, index) => {
        const evidence = rawEvidence as EvidenceItem & Record<string, unknown>;
        const rawId = text(evidence.id, `index-${index}`);
        const evidenceNodeId = `evidence:${passport.id}:${rawId}`;
        evidenceNodeByRawId.set(`${passport.id}:${rawId}`, evidenceNodeId);
        evidenceNodesByRawId.set(rawId, [...(evidenceNodesByRawId.get(rawId) || []), evidenceNodeId]);
        addNode({
          id: evidenceNodeId,
          stage: 'evidence',
          label: short(evidence.name, 'Evidence'),
          detail: `${text(evidence.type, 'Record')} · ${text(evidence.status, 'Unknown status')}`,
          meta: [evidence.hash && `hash ${String(evidence.hash)}`, evidence.signer && `signer ${String(evidence.signer)}`, evidence.timestamp && `observed ${String(evidence.timestamp)}`].filter(Boolean).join(' · ') || undefined,
          passportId: passport.id,
          evidenceId: rawId,
        });

        const identityNodeId = passportIdentityIds.get(passport.id);
        const explicitEvidenceIdentity = evidenceIdentityRef(evidence);
        if (identityNodeId && explicitEvidenceIdentity) {
          const identity = explicitIdentity(passport);
          if (identity?.id === explicitEvidenceIdentity) {
            addEdge({
              source: identityNodeId,
              target: evidenceNodeId,
              label: 'supports',
              proof: 'The evidence record carries the same explicit software identity reference.',
            });
          }
        }

        // Membership in passport.evidence is authoritative regardless of
        // whether a separate identity FK is present. The identity edge above
        // is deliberately narrower and requires an explicit matching FK.
        addEdge({
          source: passportId,
          target: evidenceNodeId,
          label: 'contains',
          proof: evidencePassportRef(evidence) === passport.id
            ? 'The evidence record explicitly references this Launch Ticket.'
            : 'The evidence item is present in the Launch Ticket’s persisted evidence collection.',
        });
      });

      const verificationRawId = text(passport.verificationId ?? passport.verification_id, '');
      const verificationStatus = text(passport.verificationStatus, '');
      if (verificationRawId || verificationStatus) {
        const verificationId = verificationRawId || `passport-${passport.id}`;
        const verificationNodeId = `verification:${verificationId}`;
        verificationNodeByRawId.set(`${passport.id}:${verificationId}`, verificationNodeId);
        addNode({
          id: verificationNodeId,
          stage: 'verification',
          label: verificationStatus ? short(verificationStatus.replace(/_/g, ' '), 'Verification') : 'Verification',
          detail: verificationRawId ? 'Persisted verification record' : 'Persisted Launch Ticket verification status',
          meta: verificationRawId ? `verification id ${verificationRawId}` : undefined,
          passportId: passport.id,
          verificationId,
        });
        addEdge({
          source: passportId,
          target: verificationNodeId,
          label: 'evaluated as',
          proof: verificationRawId ? 'The Launch Ticket contains an explicit verification record reference.' : 'The Launch Ticket contains a persisted verification status.',
        });
      }
    });

    findings.forEach((rawFinding, index) => {
      const finding = rawFinding as GraphFinding;
      const findingRawId = text(finding.id, `index-${index}`);
      const findingNodeId = `finding:${findingRawId}`;
      const passportId = text(finding.passport_id ?? finding.passportId, '');
      const evidenceRefs = findingEvidenceRefs(finding);
      const verificationRefs = findingVerificationRefs(finding);
      const hasKnownPassport = passportId && passports.some((passport) => passport.id === passportId);
      const knownEvidence = evidenceRefs
        .map((ref) => {
          if (passportId) return evidenceNodeByRawId.get(`${passportId}:${ref}`) || null;
          const matches = evidenceNodesByRawId.get(ref) || [];
          // Ambiguous evidence IDs are intentionally not resolved across passports.
          return matches.length === 1 ? matches[0] : null;
        })
        .filter(Boolean) as string[];

      // A finding without a resolvable passport/evidence relationship is not
      // rendered. This is deliberate: a row merely arriving in the findings
      // payload is not enough to claim lineage.
      if (!hasKnownPassport && knownEvidence.length === 0) return;

      addNode({
        id: findingNodeId,
        stage: 'finding',
        label: short(finding.title || finding.control_id, 'Finding'),
        detail: `${text(finding.severity, 'Severity unavailable')} · ${text(finding.status, 'Status unavailable')}`,
        meta: finding.description,
        passportId: passportId || undefined,
        findingId: findingRawId,
      });

      if (hasKnownPassport) {
        addEdge({
          source: `passport:${passportId}`,
          target: findingNodeId,
          label: 'has finding',
          proof: 'The finding explicitly references this persisted Launch Ticket ID.',
        });
      }
      knownEvidence.forEach((evidenceNodeId) => {
        addEdge({
          source: evidenceNodeId,
          target: findingNodeId,
          label: 'produced finding',
          proof: 'The finding explicitly references this evidence record.',
        });
      });

      verificationRefs.forEach((verificationRef) => {
        const verificationNodeId = verificationNodeByRawId.get(`${passportId}:${verificationRef}`);
        if (verificationNodeId) {
          addEdge({
            source: findingNodeId,
            target: verificationNodeId,
            label: 'considered by',
            proof: 'The finding explicitly references the persisted verification record.',
          });
        }
      });
    });

    const counts = {
      passport: graphNodes.filter((node) => node.stage === 'passport').length,
      identity: graphNodes.filter((node) => node.stage === 'identity').length,
      evidence: graphNodes.filter((node) => node.stage === 'evidence').length,
      finding: graphNodes.filter((node) => node.stage === 'finding').length,
      verification: graphNodes.filter((node) => node.stage === 'verification').length,
    };

    return { nodes: graphNodes, edges: graphEdges, counts };
  }, [findings, passports]);

  const needle = query.trim().toLowerCase();
  const visibleNodes = useMemo(
    () => nodes.filter((node) => `${node.label} ${node.detail} ${node.meta || ''}`.toLowerCase().includes(needle)),
    [needle, nodes],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [edges, visibleIds],
  );
  const selected = selectedId ? nodes.find((node) => node.id === selectedId) : undefined;
  const selectedRelationships = selected ? edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];

  return (
    <section className="space-y-5" aria-labelledby="trust-lineage-title">
      <header className="spr-panel p-5 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-sky-300">
              <GitBranch className="h-4 w-4" aria-hidden="true" /> Living evidence galaxy
            </div>
            <h1 id="trust-lineage-title" className="mt-2 text-3xl font-semibold tracking-tight">Launch Ticket → identity → evidence → findings → verification</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--spr-text-muted)]">
              This view is relationship-first. SPR renders only persisted identities, evidence memberships, explicit references, and recorded verification state. Missing data stays missing.
            </p>
          </div>
          <div className="grid grid-cols-5 gap-1 text-center text-[11px]">
            {STAGES.map((stage) => <div key={stage} className={`rounded-md border px-2 py-2 ${STAGE_CLASS[stage]}`}><div className="text-base font-semibold">{counts[stage]}</div><div>{STAGE_META[stage].label}</div></div>)}
          </div>
        </div>
        <label className="relative mt-5 block max-w-xl">
          <Search size={16} className="absolute left-3 top-3 text-[var(--spr-text-muted)]" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the galaxy…" aria-label="Search evidence galaxy" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-2.5 pl-9 pr-9 text-sm text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)] focus:border-[var(--spr-highlight)]/50" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear lineage search" className="absolute right-2 top-2 rounded-lg p-1 text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]"><X size={15} /></button>}
        </label>
      </header>

      <div className="spr-panel overflow-x-auto p-4 lg:p-6">
        <div className="min-w-[1180px]">
          <div className="grid grid-cols-[repeat(5,minmax(190px,1fr))] gap-3">
            {STAGES.map((stage, stageIndex) => {
              const StageIcon = STAGE_META[stage].icon;
              const stageNodes = visibleNodes.filter((node) => node.stage === stage);
              return (
                <div key={stage} className="relative min-h-[360px]">
                  <div className={`mb-3 rounded-lg border p-3 ${STAGE_CLASS[stage]}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold"><StageIcon className="h-4 w-4" aria-hidden="true" />{STAGE_META[stage].label}</div>
                    <div className="mt-1 text-[11px] opacity-75">{STAGE_META[stage].description}</div>
                  </div>
                  <div className="space-y-2">
                    {stageNodes.length === 0 && (
                      <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-xs leading-5 text-[var(--spr-text-muted)]">
                        No persisted {STAGE_META[stage].label.toLowerCase()} records are connected to the loaded data.
                      </div>
                    )}
                    {stageNodes.map((node) => {
                      const selectedNode = selectedId === node.id;
                      const related = selected ? selectedRelationships.some((edge) => edge.source === node.id || edge.target === node.id) : false;
                      const dimmed = Boolean(selectedId && !selectedNode && !related);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => { setSelectedId(node.id); setSelectedEdge(null); }}
                          className={`spr-orb-node w-full rounded-2xl border p-3 text-left transition hover:border-[var(--spr-highlight)]/50 ${selectedNode ? 'spr-orb-node--selected border-[var(--spr-highlight)]/70 bg-[var(--spr-surface-deep)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface)]'}`}
                          style={{ opacity: dimmed ? 0.35 : 1 }}
                        >
                          <div className="text-sm font-semibold text-[var(--spr-text)]">{node.label}</div>
                          <div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{node.detail}</div>
                          {node.meta && <div className="mt-2 break-words text-[10px] leading-4 text-[var(--spr-text-faint)]">{node.meta}</div>}
                        </button>
                      );
                    })}
                  </div>
                  {stageIndex < STAGES.length - 1 && <ArrowRight className="pointer-events-none absolute -right-3 top-8 z-10 hidden h-5 w-5 text-[var(--spr-text-faint)] lg:block" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="spr-panel p-5" aria-label="Constellation connections">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Recorded relationships</h2>
              <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Every luminous connection exists because SPR has a persisted relationship for it.</p>
            </div>
            <span className="text-xs text-[var(--spr-text-muted)]">{visibleEdges.length} shown</span>
          </div>
          <div className="mt-4 space-y-2">
            {visibleEdges.length === 0 && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-sm text-[var(--spr-text-muted)]">No relationship is shown because no loaded record proves one.</div>}
            {visibleEdges.map((edge) => {
              const source = nodes.find((node) => node.id === edge.source);
              const target = nodes.find((node) => node.id === edge.target);
              return (
                <button key={edgeKey(edge)} type="button" onClick={() => { setSelectedEdge(edge); setSelectedId(null); }} className="flex w-full flex-col gap-2 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-left hover:border-[var(--spr-highlight)]/40 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1"><span className="font-medium">{source?.label || 'Unknown'}</span><span className="mx-2 text-[var(--spr-text-faint)]">→</span><span className="font-medium">{target?.label || 'Unknown'}</span></span>
                  <span className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">{edge.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="spr-panel p-5" aria-label="Evidence lineage inspector">
          {selectedEdge ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">Relationship proof</div>
              <h2 className="mt-2 text-xl font-semibold">{selectedEdge.label}</h2>
              <div className="mt-4 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-sm">
                <div><span className="text-[var(--spr-text-muted)]">From:</span> {nodes.find((node) => node.id === selectedEdge.source)?.label || 'Unknown'}</div>
                <div className="mt-2"><span className="text-[var(--spr-text-muted)]">To:</span> {nodes.find((node) => node.id === selectedEdge.target)?.label || 'Unknown'}</div>
              </div>
              <div className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-xs leading-5 text-[var(--spr-text-muted)]">{selectedEdge.proof}</div>
              <button type="button" onClick={() => setSelectedEdge(null)} className="mt-4 rounded-md border border-[var(--spr-border)] px-3 py-2 text-sm hover:bg-[var(--spr-surface-deep)]">Back to lineage</button>
            </>
          ) : selected ? (
            <>
              <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${STAGE_CLASS[selected.stage]}`}>{STAGE_META[selected.stage].label}</div>
              <h2 className="mt-3 text-xl font-semibold">{selected.label}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{selected.detail}</p>
              {selected.meta && <div className="mt-3 break-words rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-xs leading-5 text-[var(--spr-text-muted)]">{selected.meta}</div>}
              <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold">Direct relationships</h3><span className="text-xs text-[var(--spr-text-muted)]">{selectedRelationships.length}</span></div>
              <div className="mt-2 space-y-2">
                {selectedRelationships.length === 0 && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]">No persisted relationship is available for this record.</div>}
                {selectedRelationships.map((edge) => {
                  const other = nodes.find((node) => node.id === (edge.source === selected.id ? edge.target : edge.source));
                  return <button key={edgeKey(edge)} type="button" onClick={() => setSelectedEdge(edge)} className="w-full rounded-lg border border-[var(--spr-border)] p-3 text-left hover:border-[var(--spr-highlight)]/40"><div className="text-xs font-semibold">{edge.label}</div><div className="mt-1 text-sm">{other?.label || 'Unknown record'}</div><div className="mt-1 text-[11px] text-[var(--spr-text-muted)]">{edge.proof}</div></button>;
                })}
              </div>
            </>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
              <div className="rounded-full border border-sky-400/20 bg-sky-400/10 p-4"><GitBranch className="h-6 w-6 text-sky-300" aria-hidden="true" /></div>
              <h2 className="mt-4 text-lg font-semibold">Galaxy inspector</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--spr-text-muted)]">Select a node or connection to inspect the persisted evidence behind it.</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="spr-panel flex flex-col gap-3 p-4 text-xs text-[var(--spr-text-muted)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Absence of an edge is intentional. SPR does not infer identity, ownership, finding provenance, or verification linkage from names, versions, or proximity.</span></div>
        <div className="flex items-center gap-2 whitespace-nowrap"><ShieldCheck size={14} aria-hidden="true" /> Evidence-first galaxy</div>
      </footer>
    </section>
  );
}
