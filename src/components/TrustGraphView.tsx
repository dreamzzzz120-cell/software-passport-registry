import { useMemo, useState } from 'react';
import { CircleHelp, Filter, Search, X } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';

type GraphAsset = { id: string; name?: string; hostName?: string; type?: string; clientId?: string; clientName?: string; version?: string };
type GraphFinding = { id?: string; title?: string; control_id?: string; passport_id?: string; passportId?: string; asset_id?: string; client_id?: string; severity?: string; status?: string; description?: string; updated_at?: string };
type GraphKind = 'client' | 'passport' | 'asset' | 'evidence' | 'finding' | 'vendor' | 'component' | 'vulnerability';
type GraphNode = { id: string; label: string; kind: GraphKind; detail: string; meta?: string; x: number; y: number };
type GraphEdge = { source: string; target: string; label: string };

interface TrustGraphViewProps {
  clients?: Client[];
  passports?: SoftwarePassport[];
  assets?: GraphAsset[];
  findings?: unknown[];
}

const COLORS: Record<GraphKind, string> = {
  vendor: '#f472b6',
  client: '#a78bfa',
  passport: '#67e8f9',
  component: '#38bdf8',
  asset: '#fbbf24',
  evidence: '#34d399',
  finding: '#fb7185',
  vulnerability: '#f87171',
};

const KIND_ORDER: GraphKind[] = ['vendor', 'client', 'passport', 'component', 'asset', 'evidence', 'finding', 'vulnerability'];

// Plain-English justification for why an edge was drawn — this is what makes the
// graph trustworthy: every relationship traces back to a specific matched field
// on already-loaded records rather than an inferred or assumed connection.
const EDGE_RATIONALE: Record<string, string> = {
  publishes: "Drawn because this passport's publisher field matches this vendor's name.",
  owns: "Drawn because the passport's clientId field matches this client's id.",
  represents: "Drawn because a loaded asset's id or name matches this passport's id or name.",
  contains: "Drawn because this component appears in the passport's SBOM array.",
  supports: "Drawn because this evidence record is nested under the passport's evidence array.",
  'has finding': "Drawn because the finding's passport_id, asset_id, or client_id references this node.",
  'has vulnerability': "Drawn because this vulnerability is nested under the passport's vulnerabilities array.",
  'affected by': "Drawn because the vulnerability's component field matches this SBOM component's name.",
};

function short(value: unknown, fallback: string) {
  const text = String(value || fallback);
  return text.length > 23 ? `${text.slice(0, 21)}…` : text;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

export default function TrustGraphView({ clients = [], passports = [], assets = [], findings = [] }: TrustGraphViewProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | GraphKind>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const graphNodes: GraphNode[] = [];
    const graphEdges: GraphEdge[] = [];
    const addNode = (node: GraphNode) => { if (!graphNodes.some((item) => item.id === node.id)) graphNodes.push(node); };
    const addEdge = (source: string, target: string, label: string) => {
      if (source !== target && !graphEdges.some((edge) => edge.source === source && edge.target === target && edge.label === label)) graphEdges.push({ source, target, label });
    };

    const columns = [
      { kind: 'client' as const, items: clients, y: 110, x: 250, getId: (item: Client) => `client:${item.id}`, getLabel: (item: Client) => item.name, getDetail: (item: Client) => `${item.domain || 'No domain'} · client record` },
      { kind: 'passport' as const, items: passports, y: 250, x: 420, getId: (item: SoftwarePassport) => `passport:${item.id}`, getLabel: (item: SoftwarePassport) => item.name, getDetail: (item: SoftwarePassport) => `v${item.version} · ${item.publisher || 'publisher unavailable'}` },
    ];
    columns.forEach((column) => column.items.forEach((item, index) => addNode({ id: column.getId(item), label: short(column.getLabel(item), column.kind), kind: column.kind, detail: column.getDetail(item), x: column.x, y: column.y + (index % 5) * 70 })));

    assets.forEach((asset, index) => addNode({ id: `asset:${asset.id}`, label: short(asset.name || asset.hostName, 'Asset'), kind: 'asset', detail: `${asset.type || 'asset'} · ${asset.version || 'version unavailable'}`, x: 760, y: 80 + (index % 7) * 70 }));

    let vendorIndex = 0;
    const seenVendors = new Set<string>();
    passports.forEach((passport, index) => {
      const passportId = `passport:${passport.id}`;
      const clientId = String((passport as SoftwarePassport & { clientId?: string }).clientId || '');
      if (clientId && clients.some((client) => client.id === clientId)) addEdge(`client:${clientId}`, passportId, 'owns');

      if (passport.publisher) {
        const vendorId = `vendor:${slug(passport.publisher)}`;
        if (!seenVendors.has(vendorId)) {
          seenVendors.add(vendorId);
          addNode({ id: vendorId, label: short(passport.publisher, 'Vendor'), kind: 'vendor', detail: 'Publisher of one or more registered passports', x: 90, y: 80 + (vendorIndex % 6) * 70 });
          vendorIndex += 1;
        }
        addEdge(vendorId, passportId, 'publishes');
      }

      const matchingAsset = assets.find((asset) => asset.id === passport.id || asset.name === passport.name);
      if (matchingAsset) addEdge(passportId, `asset:${matchingAsset.id}`, 'represents');

      passport.evidence.forEach((evidence: any, evidenceIndex) => {
        const id = `evidence:${passport.id}:${String(evidence.id || evidenceIndex)}`;
        addNode({ id, label: short(evidence.name, 'Evidence'), kind: 'evidence', detail: `${evidence.status || 'status unavailable'} · ${evidence.type || 'record'}`, meta: [evidence.hash && `hash ${evidence.hash}`, evidence.signer && `signer ${evidence.signer}`, evidence.timestamp && `observed ${evidence.timestamp}`].filter(Boolean).join(' · ') || undefined, x: 1090, y: 45 + ((index * 3 + evidenceIndex) % 9) * 60 });
        addEdge(passportId, id, 'supports');
      });

      // Rendering every SBOM component would overwhelm the graph for large
      // manifests, so only components that are flagged or tied to a known
      // vulnerability get their own node — the rest are summarized in the
      // passport's own detail text rather than fabricated as "safe" nodes.
      const components = Array.isArray(passport.sbom) ? passport.sbom : [];
      const vulnerableComponentNames = new Set((passport.vulnerabilities || []).map((v: any) => v.component));
      const riskComponents = components.filter((c: any) => c.trustLevel !== 'Trusted' || vulnerableComponentNames.has(c.name));
      riskComponents.forEach((component: any, componentIndex: number) => {
        const id = `component:${passport.id}:${slug(component.name || String(componentIndex))}`;
        addNode({ id, label: short(component.name, 'Component'), kind: 'component', detail: `${component.dependencyType || 'dependency'} · ${component.trustLevel || 'trust level unavailable'}`, meta: component.purl, x: 600, y: 60 + ((index * 4 + componentIndex) % 8) * 70 });
        addEdge(passportId, id, 'contains');
      });
      if (components.length > riskComponents.length) {
        const extra = components.length - riskComponents.length;
        const existing = graphNodes.find((n) => n.id === passportId);
        if (existing) existing.detail = `${existing.detail} · ${extra} additional trusted component${extra === 1 ? '' : 's'} not shown`;
      }

      (passport.vulnerabilities || []).forEach((vuln: any, vulnIndex: number) => {
        const id = `vulnerability:${passport.id}:${String(vuln.id || vulnIndex)}`;
        addNode({ id, label: short(vuln.title || vuln.component, 'Vulnerability'), kind: 'vulnerability', detail: `${vuln.severity || 'severity unavailable'} · ${vuln.status || 'status unavailable'}`, meta: [vuln.cvss != null && `CVSS ${vuln.cvss}`, vuln.fixedVersion && `fix ${vuln.fixedVersion}`, vuln.description].filter(Boolean).join(' · ') || undefined, x: 1260, y: 60 + (vulnIndex % 8) * 70 });
        const matchedComponent = riskComponents.find((c: any) => c.name === vuln.component);
        if (matchedComponent) addEdge(`component:${passport.id}:${slug(matchedComponent.name || '')}`, id, 'affected by');
        else addEdge(passportId, id, 'has vulnerability');
      });
    });

    findings.forEach((raw, index) => {
      const finding = raw as GraphFinding;
      const id = `finding:${String(finding.id || index)}`;
      const linkedPassportId = finding.passport_id || finding.passportId;
      addNode({ id, label: short(finding.title || finding.control_id, 'Finding'), kind: 'finding', detail: `${finding.severity || 'severity unavailable'} · ${finding.status || 'status unavailable'}`, meta: finding.description, x: 930, y: 90 + (index % 9) * 65 });
      if (linkedPassportId && passports.some((passport) => passport.id === linkedPassportId)) addEdge(`passport:${linkedPassportId}`, id, 'has finding');
      else if (finding.asset_id && assets.some((asset) => asset.id === finding.asset_id)) addEdge(`asset:${finding.asset_id}`, id, 'has finding');
      else if (finding.client_id && clients.some((client) => client.id === finding.client_id)) addEdge(`client:${finding.client_id}`, id, 'has finding');
    });

    return { nodes: graphNodes, edges: graphEdges };
  }, [assets, clients, findings, passports]);

  const visibleNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return nodes.filter((node) => (kindFilter === 'all' || node.kind === kindFilter) && (!needle || `${node.label} ${node.detail} ${node.meta || ''}`.toLowerCase().includes(needle)));
  }, [kindFilter, nodes, query]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const selected = nodes.find((node) => node.id === selectedId);
  const nodeById = new Map<string, GraphNode>(nodes.map((node): [string, GraphNode] => [node.id, node]));
  const selectedEdge = selectedEdgeKey ? edges.find((edge) => `${edge.source}-${edge.target}-${edge.label}` === selectedEdgeKey) : undefined;

  const selectNode = (id: string) => { setSelectedId(id); setSelectedEdgeKey(null); };
  const selectEdge = (edge: GraphEdge) => { setSelectedEdgeKey(`${edge.source}-${edge.target}-${edge.label}`); setSelectedId(null); };

  return (
    <section className="space-y-6" aria-labelledby="trust-graph-title">
      <header className="rounded-3xl border border-white/[.08] bg-white/[.035] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Trust graph</div>
            <h1 id="trust-graph-title" className="mt-2 text-3xl font-semibold tracking-tight">Observed relationships</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Relationships are drawn only when a field on one loaded record matches another. Click a node for its record, or click a relationship line for why it was drawn.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>{nodes.length} nodes</span><span>·</span><span>{edges.length} relationships</span></div>
        </div>
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded records…" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-9 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/30" />{query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-2 rounded-lg p-1 text-slate-500 hover:text-white"><X size={15} /></button>}</label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3"><Filter size={15} className="text-slate-500" /><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} className="bg-transparent py-2.5 text-sm text-slate-300 outline-none"><option value="all">All record types</option>{KIND_ORDER.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        </div>
      </header>

      <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#080d17]">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 1400 680" role="img" aria-label="Trust graph of loaded tenant records" className="h-[560px] min-w-[1200px] w-full">
            <defs><pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#ffffff" strokeOpacity=".035" /></pattern></defs>
            <rect width="1400" height="680" fill="url(#graph-grid)" />
            {visibleEdges.map((edge) => {
              const source = nodeById.get(edge.source); const target = nodeById.get(edge.target); if (!source || !target) return null;
              const key = `${edge.source}-${edge.target}-${edge.label}`;
              const isSelected = selectedEdgeKey === key;
              return (
                <g key={key} role="button" tabIndex={0} onClick={() => selectEdge(edge)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectEdge(edge); }} className="cursor-pointer">
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={isSelected ? '#67e8f9' : '#94a3b8'} strokeOpacity={isSelected ? '.7' : '.25'} strokeWidth={isSelected ? 2 : 1} />
                  <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 5} fill={isSelected ? '#67e8f9' : '#64748b'} fontSize="9" textAnchor="middle">{edge.label}</text>
                </g>
              );
            })}
            {visibleNodes.map((node) => <g key={node.id} role="button" tabIndex={0} onClick={() => selectNode(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectNode(node.id); }} className="cursor-pointer"><circle cx={node.x} cy={node.y} r={selectedId === node.id ? 23 : 18} fill={COLORS[node.kind]} fillOpacity=".18" stroke={COLORS[node.kind]} strokeWidth={selectedId === node.id ? 3 : 1.5} /><text x={node.x} y={node.y + 3} fill={COLORS[node.kind]} fontSize="9" textAnchor="middle" fontWeight="700">{node.kind.slice(0, 4).toUpperCase()}</text><text x={node.x} y={node.y + 34} fill="#cbd5e1" fontSize="11" textAnchor="middle">{node.label}</text></g>)}
            {!visibleNodes.length && <text x="700" y="340" fill="#94a3b8" fontSize="15" textAnchor="middle">No loaded records match this filter.</text>}
          </svg>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-white/[.07] px-5 py-4 text-xs text-slate-400">{KIND_ORDER.map((kind) => <span key={kind} className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[kind] }} />{kind}</span>)}<span className="ml-auto inline-flex items-center gap-1 text-slate-500"><CircleHelp size={14} /> click a node or line for details</span></div>
      </div>

      {selected && <aside className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[.05] p-5" aria-label="Selected graph record"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: COLORS[selected.kind] }}>{selected.kind}</div><h2 className="mt-1 text-lg font-semibold text-white">{selected.label}</h2><p className="mt-2 text-sm text-slate-300">{selected.detail}</p>{selected.meta && <p className="mt-2 text-xs leading-5 text-slate-500">{selected.meta}</p>}</div><button onClick={() => setSelectedId(null)} aria-label="Close selected record" className="rounded-lg p-1 text-slate-500 hover:text-white"><X size={16} /></button></div><div className="mt-4 text-xs text-slate-500">Record ID: <code className="text-slate-400">{selected.id.split(':').slice(1).join(':')}</code></div></aside>}

      {selectedEdge && (() => {
        const source = nodeById.get(selectedEdge.source); const target = nodeById.get(selectedEdge.target); if (!source || !target) return null;
        return (
          <aside className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[.05] p-5" aria-label="Selected relationship">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Relationship</div>
                <h2 className="mt-1 text-lg font-semibold text-white">{source.label} <span className="text-slate-500">— {selectedEdge.label} →</span> {target.label}</h2>
                <p className="mt-2 text-sm text-slate-300">{EDGE_RATIONALE[selectedEdge.label] || 'Drawn because the two records share a matching identifier.'}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/[.07] bg-black/20 p-3 text-xs"><div className="font-semibold" style={{ color: COLORS[source.kind] }}>{source.kind} · {source.label}</div><div className="mt-1 text-slate-400">{source.detail}</div></div>
                  <div className="rounded-xl border border-white/[.07] bg-black/20 p-3 text-xs"><div className="font-semibold" style={{ color: COLORS[target.kind] }}>{target.kind} · {target.label}</div><div className="mt-1 text-slate-400">{target.detail}</div></div>
                </div>
              </div>
              <button onClick={() => setSelectedEdgeKey(null)} aria-label="Close selected relationship" className="rounded-lg p-1 text-slate-500 hover:text-white"><X size={16} /></button>
            </div>
          </aside>
        );
      })()}
    </section>
  );
}
