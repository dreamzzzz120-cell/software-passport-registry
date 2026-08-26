import { useMemo, useState } from 'react';
import { CircleHelp, Filter, Search, X } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';

type GraphAsset = { id: string; name?: string; hostName?: string; type?: string; clientId?: string; clientName?: string; version?: string };
type GraphFinding = { id?: string; title?: string; control_id?: string; passport_id?: string; passportId?: string; asset_id?: string; client_id?: string; severity?: string; status?: string; description?: string; updated_at?: string };
type GraphNode = { id: string; label: string; kind: 'client' | 'passport' | 'asset' | 'evidence' | 'finding'; detail: string; meta?: string; x: number; y: number };
type GraphEdge = { source: string; target: string; label: string };

interface TrustGraphViewProps {
  clients?: Client[];
  passports?: SoftwarePassport[];
  assets?: GraphAsset[];
  findings?: unknown[];
}

const COLORS: Record<GraphNode['kind'], string> = {
  client: '#a78bfa',
  passport: '#67e8f9',
  asset: '#fbbf24',
  evidence: '#34d399',
  finding: '#fb7185',
};

function short(value: unknown, fallback: string) {
  const text = String(value || fallback);
  return text.length > 23 ? `${text.slice(0, 21)}…` : text;
}

export default function TrustGraphView({ clients = [], passports = [], assets = [], findings = [] }: TrustGraphViewProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | GraphNode['kind']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const graphNodes: GraphNode[] = [];
    const graphEdges: GraphEdge[] = [];
    const addNode = (node: GraphNode) => { if (!graphNodes.some((item) => item.id === node.id)) graphNodes.push(node); };
    const addEdge = (source: string, target: string, label: string) => {
      if (source !== target && !graphEdges.some((edge) => edge.source === source && edge.target === target && edge.label === label)) graphEdges.push({ source, target, label });
    };
    const columns = [
      { kind: 'client' as const, items: clients, y: 110, getId: (item: Client) => `client:${item.id}`, getLabel: (item: Client) => item.name, getDetail: (item: Client) => `${item.domain || 'No domain'} · client record` },
      { kind: 'passport' as const, items: passports, y: 250, getId: (item: SoftwarePassport) => `passport:${item.id}`, getLabel: (item: SoftwarePassport) => item.name, getDetail: (item: SoftwarePassport) => `v${item.version} · ${item.publisher || 'publisher unavailable'}` },
    ];
    columns.forEach((column) => column.items.forEach((item, index) => addNode({ id: column.getId(item), label: short(column.getLabel(item), column.kind), kind: column.kind, detail: column.getDetail(item), x: column.kind === 'client' ? 150 : 390, y: column.y + (index % 5) * 70 })));
    assets.forEach((asset, index) => addNode({ id: `asset:${asset.id}`, label: short(asset.name || asset.hostName, 'Asset'), kind: 'asset', detail: `${asset.type || 'asset'} · ${asset.version || 'version unavailable'}`, x: 640, y: 80 + (index % 7) * 70 }));
    passports.forEach((passport, index) => {
      const passportId = `passport:${passport.id}`;
      const clientId = String((passport as SoftwarePassport & { clientId?: string }).clientId || '');
      if (clientId && clients.some((client) => client.id === clientId)) addEdge(`client:${clientId}`, passportId, 'owns');
      const matchingAsset = assets.find((asset) => asset.id === passport.id || asset.name === passport.name);
      if (matchingAsset) addEdge(passportId, `asset:${matchingAsset.id}`, 'represents');
      passport.evidence.forEach((evidence: any, evidenceIndex) => {
        const id = `evidence:${passport.id}:${String(evidence.id || evidenceIndex)}`;
        addNode({ id, label: short(evidence.name, 'Evidence'), kind: 'evidence', detail: `${evidence.status || 'status unavailable'} · ${evidence.type || 'record'}`, x: 875, y: 45 + ((index * 3 + evidenceIndex) % 9) * 60 });
        addEdge(passportId, id, 'supports');
      });
    });
    findings.forEach((raw, index) => {
      const finding = raw as GraphFinding;
      const id = `finding:${String(finding.id || index)}`;
      const linkedPassportId = finding.passport_id || finding.passportId;
      addNode({ id, label: short(finding.title || finding.control_id, 'Finding'), kind: 'finding', detail: `${finding.severity || 'severity unavailable'} · ${finding.status || 'status unavailable'}`, meta: finding.description, x: 875, y: 90 + (index % 9) * 65 });
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

  return (
    <section className="space-y-6" aria-labelledby="trust-graph-title">
      <header className="rounded-3xl border border-white/[.08] bg-white/[.035] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Trust graph</div>
            <h1 id="trust-graph-title" className="mt-2 text-3xl font-semibold tracking-tight">Observed relationships</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Relationships are drawn only when IDs match loaded client, passport, asset, evidence, and finding records. Unlinked records remain visible without an inferred relationship.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>{nodes.length} nodes</span><span>·</span><span>{edges.length} relationships</span></div>
        </div>
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded records…" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-9 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/30" />{query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-2 rounded-lg p-1 text-slate-500 hover:text-white"><X size={15} /></button>}</label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3"><Filter size={15} className="text-slate-500" /><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} className="bg-transparent py-2.5 text-sm text-slate-300 outline-none"><option value="all">All record types</option>{(['client', 'passport', 'asset', 'evidence', 'finding'] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        </div>
      </header>

      <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#080d17]">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 1100 620" role="img" aria-label="Trust graph of loaded tenant records" className="h-[540px] min-w-[900px] w-full">
            <defs><pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#ffffff" strokeOpacity=".035" /></pattern></defs>
            <rect width="1100" height="620" fill="url(#graph-grid)" />
            {visibleEdges.map((edge) => { const source = nodeById.get(edge.source); const target = nodeById.get(edge.target); if (!source || !target) return null; return <g key={`${edge.source}-${edge.target}-${edge.label}`}><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#94a3b8" strokeOpacity=".25" /><text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 5} fill="#64748b" fontSize="9" textAnchor="middle">{edge.label}</text></g>; })}
            {visibleNodes.map((node) => <g key={node.id} role="button" tabIndex={0} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id); }} className="cursor-pointer"><circle cx={node.x} cy={node.y} r={selectedId === node.id ? 23 : 18} fill={COLORS[node.kind]} fillOpacity=".18" stroke={COLORS[node.kind]} strokeWidth={selectedId === node.id ? 3 : 1.5} /><text x={node.x} y={node.y + 3} fill={COLORS[node.kind]} fontSize="9" textAnchor="middle" fontWeight="700">{node.kind.slice(0, 4).toUpperCase()}</text><text x={node.x} y={node.y + 34} fill="#cbd5e1" fontSize="11" textAnchor="middle">{node.label}</text></g>)}
            {!visibleNodes.length && <text x="550" y="300" fill="#94a3b8" fontSize="15" textAnchor="middle">No loaded records match this filter.</text>}
          </svg>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-white/[.07] px-5 py-4 text-xs text-slate-400">{(Object.keys(COLORS) as GraphNode['kind'][]).map((kind) => <span key={kind} className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[kind] }} />{kind}</span>)}<span className="ml-auto inline-flex items-center gap-1 text-slate-500"><CircleHelp size={14} /> click a node for details</span></div>
      </div>

      {selected && <aside className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[.05] p-5" aria-label="Selected graph record"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: COLORS[selected.kind] }}>{selected.kind}</div><h2 className="mt-1 text-lg font-semibold text-white">{selected.label}</h2><p className="mt-2 text-sm text-slate-300">{selected.detail}</p>{selected.meta && <p className="mt-2 text-xs leading-5 text-slate-500">{selected.meta}</p>}</div><button onClick={() => setSelectedId(null)} aria-label="Close selected record" className="rounded-lg p-1 text-slate-500 hover:text-white"><X size={16} /></button></div><div className="mt-4 text-xs text-slate-500">Record ID: <code className="text-slate-400">{selected.id.split(':').slice(1).join(':')}</code></div></aside>}
    </section>
  );
}
