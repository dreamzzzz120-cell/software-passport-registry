import { useMemo, useState, type MouseEvent } from 'react';
import { CircleHelp, Filter, Maximize2, Search, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';

type GraphAsset = { id: string; name?: string; hostName?: string; type?: string; version?: string };
type GraphFinding = { id?: string; title?: string; control_id?: string; passport_id?: string; passportId?: string; asset_id?: string; client_id?: string; severity?: string; status?: string; description?: string };
type GraphKind = 'client' | 'passport' | 'asset' | 'evidence' | 'finding' | 'component' | 'vulnerability';
type GraphNode = { id: string; label: string; kind: GraphKind; detail: string; meta?: string; x: number; y: number };
type GraphEdge = { source: string; target: string; label: string };

interface TrustGraphViewProps { clients?: Client[]; passports?: SoftwarePassport[]; assets?: GraphAsset[]; findings?: unknown[]; }

const COLORS: Record<GraphKind, string> = { client: 'var(--spr-highlight)', passport: '#4ec9b0', component: '#9cdcfe', asset: 'var(--spr-amber)', evidence: 'var(--spr-green)', finding: 'var(--spr-red)', vulnerability: '#d16969' };
const KIND_ORDER: GraphKind[] = ['client', 'passport', 'component', 'asset', 'evidence', 'finding', 'vulnerability'];
const EDGE_RATIONALE: Record<string, string> = {
  owns: "Drawn from the passport's persisted clientId relationship.",
  contains: "Drawn because this component is present in the passport's SBOM evidence.",
  supports: "Drawn because this evidence record is present in the passport's evidence collection.",
  'has finding': "Drawn because the finding explicitly references this passport, asset, or client by persisted ID.",
  'has vulnerability': "Drawn because this vulnerability is present in the passport's vulnerability collection or has an explicit persisted component identity.",
};
const short = (value: unknown, fallback: string) => { const text = String(value || fallback); return text.length > 23 ? `${text.slice(0, 21)}…` : text; };

export default function TrustGraphView({ clients = [], passports = [], assets = [], findings = [] }: TrustGraphViewProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | GraphKind>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const { nodes, edges } = useMemo(() => {
    const ns: GraphNode[] = [], es: GraphEdge[] = [];
    const addNode = (node: GraphNode) => { if (!ns.some(n => n.id === node.id)) ns.push(node); };
    const addEdge = (source: string, target: string, label: string) => { if (source !== target && !es.some(e => e.source === source && e.target === target && e.label === label)) es.push({ source, target, label }); };

    clients.forEach((c, i) => addNode({ id: `client:${c.id}`, label: short(c.name, 'Client'), kind: 'client', detail: `${c.domain || 'No domain'} · client record`, x: 170, y: 100 + (i % 6) * 85 }));
    passports.forEach((p, i) => addNode({ id: `passport:${p.id}`, label: short(p.name, 'Passport'), kind: 'passport', detail: `v${p.version} · ${p.publisher || 'publisher unavailable'}`, x: 410, y: 140 + (i % 6) * 85 }));
    assets.forEach((a, i) => addNode({ id: `asset:${a.id}`, label: short(a.name || a.hostName, 'Asset'), kind: 'asset', detail: `${a.type || 'asset'} · ${a.version || 'version unavailable'}`, x: 780, y: 80 + (i % 7) * 80 }));

    passports.forEach((p, pi) => {
      const pid = `passport:${p.id}`;
      const clientId = String((p as SoftwarePassport & { clientId?: string }).clientId || '');
      if (clientId && clients.some(c => c.id === clientId)) addEdge(`client:${clientId}`, pid, 'owns');

      // Publisher text is descriptive metadata. It is NOT a persisted Vendor FK.
      // Therefore this graph intentionally creates no Vendor node and no publishes edge.

      p.evidence.forEach((e: any, ei) => {
        const id = `evidence:${p.id}:${String(e.id || ei)}`;
        addNode({ id, label: short(e.name, 'Evidence'), kind: 'evidence', detail: `${e.status || 'status unavailable'} · ${e.type || 'record'}`, meta: [e.hash && `hash ${e.hash}`, e.signer && `signer ${e.signer}`, e.timestamp && `observed ${e.timestamp}`].filter(Boolean).join(' · ') || undefined, x: 1040, y: 45 + ((pi * 3 + ei) % 9) * 60 });
        addEdge(pid, id, 'supports');
      });

      const components = Array.isArray(p.sbom) ? p.sbom : [];
      const riskComponents = components.filter((c: any) => c.trustLevel !== 'Trusted');
      riskComponents.forEach((c: any, ci) => {
        const identity = c.purl || c.id || c.componentId;
        const id = identity ? `component:${p.id}:${String(identity)}` : `component:${p.id}:index:${ci}`;
        addNode({ id, label: short(c.name, 'Component'), kind: 'component', detail: `${c.dependencyType || 'dependency'} · ${c.trustLevel || 'trust level unavailable'}`, meta: c.purl, x: 610, y: 60 + ((pi * 4 + ci) % 8) * 70 });
        addEdge(pid, id, 'contains');
      });
      if (components.length > riskComponents.length) {
        const node = ns.find(n => n.id === pid);
        if (node) node.detail += ` · ${components.length - riskComponents.length} additional trusted component${components.length - riskComponents.length === 1 ? '' : 's'} not shown`;
      }

      (p.vulnerabilities || []).forEach((v: any, vi) => {
        const id = `vulnerability:${p.id}:${String(v.id || vi)}`;
        addNode({ id, label: short(v.title || v.component, 'Vulnerability'), kind: 'vulnerability', detail: `${v.severity || 'severity unavailable'} · ${v.status || 'status unavailable'}`, meta: [v.cvss != null && `CVSS ${v.cvss}`, v.fixedVersion && `fix ${v.fixedVersion}`, v.description].filter(Boolean).join(' · ') || undefined, x: 1270, y: 60 + (vi % 8) * 70 });

        // NEVER match vulnerability.component to component.name. A matching
        // name is not identity evidence. Only an explicit persisted component
        // ID can create a component → vulnerability relationship.
        const componentId = v.componentId || v.component_id;
        if (componentId) {
          const target = ns.find(n => n.kind === 'component' && (n.id === `component:${p.id}:${String(componentId)}`));
          if (target) addEdge(target.id, id, 'has vulnerability'); else addEdge(pid, id, 'has vulnerability');
        } else addEdge(pid, id, 'has vulnerability');
      });
    });

    findings.forEach((raw, i) => {
      const f = raw as GraphFinding, id = `finding:${String(f.id || i)}`;
      const linkedPassport = f.passport_id || f.passportId;
      addNode({ id, label: short(f.title || f.control_id, 'Finding'), kind: 'finding', detail: `${f.severity || 'severity unavailable'} · ${f.status || 'status unavailable'}`, meta: f.description, x: 930, y: 90 + (i % 9) * 65 });
      if (linkedPassport && passports.some(p => p.id === linkedPassport)) addEdge(`passport:${linkedPassport}`, id, 'has finding');
      else if (f.asset_id && assets.some(a => a.id === f.asset_id)) addEdge(`asset:${f.asset_id}`, id, 'has finding');
      else if (f.client_id && clients.some(c => c.id === f.client_id)) addEdge(`client:${f.client_id}`, id, 'has finding');
    });
    return { nodes: ns, edges: es };
  }, [assets, clients, findings, passports]);

  const visibleNodes = useMemo(() => { const q = query.trim().toLowerCase(); return nodes.filter(n => (kindFilter === 'all' || n.kind === kindFilter) && (!q || `${n.label} ${n.detail} ${n.meta || ''}`.toLowerCase().includes(q))); }, [kindFilter, nodes, query]);
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const selected = nodes.find(n => n.id === selectedId);
  const selectedEdge = selectedEdgeKey ? edges.find(e => `${e.source}-${e.target}-${e.label}` === selectedEdgeKey) : undefined;
  const activeId = hoveredId || selectedId;
  const activeNeighbors = useMemo(() => { if (!activeId) return null; const set = new Set<string>([activeId]); visibleEdges.forEach(e => { if (e.source === activeId) set.add(e.target); if (e.target === activeId) set.add(e.source); }); return set; }, [activeId, visibleEdges]);
  const connectedEdges = selected ? visibleEdges.filter(e => e.source === selected.id || e.target === selected.id) : [];
  const selectNode = (id: string) => { setSelectedId(id); setSelectedEdgeKey(null); };
  const selectEdge = (e: GraphEdge) => { setSelectedEdgeKey(`${e.source}-${e.target}-${e.label}`); setSelectedId(null); };
  const zoomBy = (factor: number) => setView(v => ({ ...v, k: Math.min(2.5, Math.max(0.5, v.k * factor)) }));

  return <section className="space-y-6" aria-labelledby="trust-graph-title">
    <header className="spr-panel p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#9cdcfe]"><Share2 className="h-4 w-4" /> Trust graph</div><h1 id="trust-graph-title" className="mt-2 text-3xl font-semibold tracking-tight">Observed relationships</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Relationships are drawn only from explicit persisted relationships or evidence collections. Matching names or IDs alone never create a trust relationship. Click a node for its record, or click a relationship line for why it was drawn.</p></div><div className="flex gap-2 text-xs text-[var(--spr-text-muted)]"><span>{nodes.length} nodes</span><span>·</span><span>{edges.length} relationships</span></div></div>
      <div className="mt-5 flex flex-col gap-3 md:flex-row"><label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3 text-[var(--spr-text-muted)]" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search loaded records…" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-2.5 pl-9 pr-9 text-sm text-[var(--spr-text)] outline-none" />{query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-2 p-1"><X size={15} /></button>}</label><label className="flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3"><Filter size={15} /><select value={kindFilter} onChange={e => setKindFilter(e.target.value as typeof kindFilter)} className="bg-transparent py-2.5 text-sm"><option value="all">All record types</option>{KIND_ORDER.map(k => <option key={k} value={k}>{k}</option>)}</select></label></div>
    </header>
    <div className="overflow-hidden spr-panel relative"><div className="absolute right-3 top-3 z-10 flex gap-1"><button onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="grid h-7 w-7 place-items-center rounded-md border"><ZoomIn size={14} /></button><button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="grid h-7 w-7 place-items-center rounded-md border"><ZoomOut size={14} /></button><button onClick={() => setView({ x: 0, y: 0, k: 1 })} aria-label="Reset view" className="grid h-7 w-7 place-items-center rounded-md border"><Maximize2 size={13} /></button></div>
      <div className="overflow-x-auto"><svg viewBox="0 0 1400 680" role="img" aria-label="Trust graph of loaded tenant records" className="h-[560px] min-w-[1200px] w-full cursor-grab" onWheel={e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? .9 : 1.1); }} onMouseDown={e => setDrag({ x: e.clientX, y: e.clientY })} onMouseMove={e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; setDrag({ x: e.clientX, y: e.clientY }); setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })); }} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}><defs><pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#ffffff" strokeOpacity=".035" /></pattern></defs><rect width="1400" height="680" fill="url(#graph-grid)" /><g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {visibleEdges.map(e => { const s = nodeById.get(e.source), t = nodeById.get(e.target); if (!s || !t) return null; const key = `${e.source}-${e.target}-${e.label}`, active = selectedEdgeKey === key || !!activeId && (e.source === activeId || e.target === activeId); return <g key={key} role="button" tabIndex={0} onClick={() => selectEdge(e)} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') selectEdge(e); }}><title>{`${s.label} — ${e.label} → ${t.label}`}</title><line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={active ? 'var(--spr-highlight)' : 'var(--spr-gray)'} strokeOpacity={active ? .85 : activeId ? .08 : .25} strokeWidth={active ? 2 : 1} /><text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 5} fill={active ? 'var(--spr-highlight)' : 'var(--spr-text-faint)'} fontSize="11" textAnchor="middle">{e.label}</text></g>; })}
        {visibleNodes.map(n => { const active = activeId === n.id, neighbor = activeNeighbors ? activeNeighbors.has(n.id) : true; return <g key={n.id} role="button" tabIndex={0} onClick={() => selectNode(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') selectNode(n.id); }} onMouseEnter={() => setHoveredId(n.id)} onMouseLeave={() => setHoveredId(null)} opacity={activeId && !neighbor ? .2 : 1}><title>{`${n.kind}: ${n.label} — ${n.detail}`}</title><circle cx={n.x} cy={n.y} r={selectedId === n.id ? 23 : active ? 21 : 18} fill={COLORS[n.kind]} fillOpacity={active ? .3 : .18} stroke={COLORS[n.kind]} strokeWidth={selectedId === n.id || active ? 3 : 1.5} /><text x={n.x} y={n.y + 3} fill={COLORS[n.kind]} fontSize="11" textAnchor="middle" fontWeight="700">{n.kind.slice(0, 4).toUpperCase()}</text><text x={n.x} y={n.y + 34} fill="var(--spr-text)" fontSize="11" textAnchor="middle">{n.label}</text></g>; })}
        {!visibleNodes.length && <text x="700" y="340" fill="var(--spr-text-muted)" fontSize="15" textAnchor="middle">No loaded records match this filter.</text>}
      </g></svg></div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--spr-border)] px-5 py-4 text-xs text-[var(--spr-text-muted)]">{KIND_ORDER.map(k => { const count = nodes.filter(n => n.kind === k).length, active = kindFilter === k; return <button key={k} onClick={() => setKindFilter(active ? 'all' : k)} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ borderColor: active ? COLORS[k] : 'var(--spr-border)', color: active ? COLORS[k] : 'var(--spr-text-muted)' }}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[k] }} />{k}<span>{count}</span></button>; })}<span className="ml-auto inline-flex items-center gap-1"><CircleHelp size={14} /> hover to trace connections, click for details</span></div>
    </div>

    {selected && <aside className="rounded-md border border-[var(--spr-accent)] bg-[var(--spr-accent-soft)] p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.2em]" style={{ color: COLORS[selected.kind] }}>{selected.kind}</div><h2 className="mt-1 text-lg font-semibold">{selected.label}</h2><p className="mt-2 text-sm">{selected.detail}</p>{selected.meta && <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{selected.meta}</p>}</div><button onClick={() => setSelectedId(null)} aria-label="Close selected record"><X size={16} /></button></div><div className="mt-4 text-xs">Record ID: <code>{selected.id.split(':').slice(1).join(':')}</code></div>{connectedEdges.length > 0 && <div className="mt-4 border-t pt-4"><div className="text-xs font-semibold uppercase">{connectedEdges.length} connected record{connectedEdges.length === 1 ? '' : 's'}</div><div className="mt-2 flex flex-wrap gap-2">{connectedEdges.map(e => { const other = nodeById.get(e.source === selected.id ? e.target : e.source); return other ? <button key={`${e.source}-${e.target}-${e.label}`} onClick={() => selectNode(other.id)} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"><span style={{ color: COLORS[other.kind] }}>●</span>{e.source === selected.id ? '→' : '←'} {e.label} {other.label}</button> : null; })}</div></div>}</aside>}
    {selectedEdge && (() => { const s = nodeById.get(selectedEdge.source), t = nodeById.get(selectedEdge.target); if (!s || !t) return null; return <aside className="rounded-md border border-[var(--spr-accent)] bg-[var(--spr-accent-soft)] p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-semibold uppercase">Relationship</div><h2 className="mt-1 text-lg font-semibold">{s.label} <span className="text-[var(--spr-text-muted)]">— {selectedEdge.label} →</span> {t.label}</h2><p className="mt-2 text-sm">{EDGE_RATIONALE[selectedEdge.label] || 'Drawn because the records contain an explicit persisted relationship.'}</p></div><button onClick={() => setSelectedEdgeKey(null)} aria-label="Close selected relationship"><X size={16} /></button></div></aside>; })()}
  </section>;
}
