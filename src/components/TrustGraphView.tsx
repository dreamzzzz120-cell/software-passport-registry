import { useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { CircleHelp, Filter, Maximize2, Network, Search, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';

type GraphAsset = { id: string; name?: string; hostName?: string; type?: string; clientId?: string; clientName?: string; version?: string };
type GraphFinding = { id?: string; title?: string; control_id?: string; passport_id?: string; passportId?: string; asset_id?: string; client_id?: string; severity?: string; status?: string; description?: string; updated_at?: string };
type GraphKind = 'vendor' | 'client' | 'passport' | 'component' | 'asset' | 'evidence' | 'finding' | 'vulnerability';
type GraphNode = { id: string; label: string; kind: GraphKind; detail: string; meta?: string; x: number; y: number };
type GraphEdge = { source: string; target: string; label: string };

interface TrustGraphViewProps { clients?: Client[]; passports?: SoftwarePassport[]; assets?: GraphAsset[]; findings?: unknown[]; }

const KIND_ORDER: GraphKind[] = ['vendor', 'client', 'passport', 'component', 'asset', 'evidence', 'finding', 'vulnerability'];
const KIND_LABEL: Record<GraphKind, string> = { vendor: 'Vendor', client: 'Client', passport: 'Passport', component: 'Component', asset: 'Asset', evidence: 'Evidence', finding: 'Finding', vulnerability: 'Vulnerability' };
const KIND_CLASS: Record<GraphKind, string> = {
  vendor: 'text-fuchsia-300 border-fuchsia-400/30 bg-fuchsia-400/10',
  client: 'text-[var(--spr-highlight)] border-[var(--spr-highlight)]/30 bg-[var(--spr-highlight)]/10',
  passport: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  component: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
  asset: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  evidence: 'text-green-300 border-green-400/30 bg-green-400/10',
  finding: 'text-red-300 border-red-400/30 bg-red-400/10',
  vulnerability: 'text-rose-300 border-rose-400/30 bg-rose-400/10',
};
const EDGE_RATIONALE: Record<string, string> = {
  publishes: "Drawn from the passport's persisted publisher relationship.",
  owns: "Drawn from an explicit persisted client relationship.",
  contains: "Drawn because the component is present in the passport's SBOM evidence.",
  supports: "Drawn because the evidence record is present in the passport's evidence collection.",
  'has finding': 'Drawn because the finding explicitly references a persisted passport, asset, or client ID.',
  'has vulnerability': "Drawn because the vulnerability is present in the passport's vulnerability collection.",
  'affected by': 'Drawn because the vulnerability explicitly identifies the persisted component identity.',
};
const GRAPH_WIDTH = 1480;
const GRAPH_HEIGHT = 720;
const MAX_NODES = 450;
const MAX_EVIDENCE_PER_PASSPORT = 80;
const MAX_COMPONENTS_PER_PASSPORT = 120;
const MAX_VULNERABILITIES_PER_PASSPORT = 80;

function short(value: unknown, fallback: string, length = 25) { const text = String(value || fallback).trim(); return text.length > length ? `${text.slice(0, length - 2)}…` : text; }
function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'; }
function safeText(value: unknown, fallback = 'Unavailable') { const text = String(value ?? '').trim(); return text || fallback; }
function edgeKey(edge: GraphEdge) { return `${edge.source}::${edge.target}::${edge.label}`; }
function clampZoom(k: number) { return Math.min(2.8, Math.max(0.45, k)); }

export default function TrustGraphView({ clients = [], passports = [], assets = [], findings = [] }: TrustGraphViewProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | GraphKind>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [showOnlyConnected, setShowOnlyConnected] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const { nodes, edges, truncated } = useMemo(() => {
    const graphNodes: GraphNode[] = [];
    const graphEdges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    const addNode = (node: GraphNode) => { if (graphNodes.length >= MAX_NODES || nodeIds.has(node.id)) return; nodeIds.add(node.id); graphNodes.push(node); };
    const addEdge = (source: string, target: string, label: string) => {
      if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) return;
      const edge = { source, target, label }; const key = edgeKey(edge); if (edgeKeys.has(key)) return; edgeKeys.add(key); graphEdges.push(edge);
    };

    clients.forEach((client, index) => addNode({ id: `client:${client.id}`, label: short(client.name, 'Client'), kind: 'client', detail: `${safeText(client.domain, 'No domain')} · client record`, x: 120, y: 100 + (index % 8) * 78 }));
    passports.forEach((passport, index) => addNode({ id: `passport:${passport.id}`, label: short(passport.name, 'Passport'), kind: 'passport', detail: `v${safeText(passport.version, '?')} · ${safeText(passport.publisher, 'publisher unavailable')}`, x: 430, y: 90 + (index % 8) * 78 }));
    assets.forEach((asset, index) => addNode({ id: `asset:${asset.id}`, label: short(asset.name || asset.hostName, 'Asset'), kind: 'asset', detail: `${safeText(asset.type, 'asset')} · ${safeText(asset.version, 'version unavailable')}`, x: 760, y: 90 + (index % 8) * 78 }));

    const seenVendors = new Set<string>(); let vendorIndex = 0;
    passports.forEach((passport, passportIndex) => {
      const passportId = `passport:${passport.id}`;
      const clientId = String((passport as SoftwarePassport & { clientId?: string }).clientId || '');
      if (clientId && clients.some((client) => client.id === clientId)) addEdge(`client:${clientId}`, passportId, 'owns');
      if (passport.publisher) {
        const vendorId = `vendor:${slug(passport.publisher)}`;
        if (!seenVendors.has(vendorId)) { seenVendors.add(vendorId); addNode({ id: vendorId, label: short(passport.publisher, 'Vendor'), kind: 'vendor', detail: 'Publisher of one or more registered passports', x: 95, y: 45 + (vendorIndex % 8) * 78 }); vendorIndex += 1; }
        addEdge(vendorId, passportId, 'publishes');
      }
      assets.forEach((asset) => { if (asset.clientId && asset.clientId === clientId && clientId) addEdge(`client:${clientId}`, `asset:${asset.id}`, 'owns'); });

      // Never infer Passport → Asset from matching names or IDs. An apparent
      // match is not evidence of identity or ownership. Asset relationships
      // are rendered only when an authoritative persisted FK is supplied by
      // the graph data model; this component currently has no such field.

      const evidence = Array.isArray(passport.evidence) ? passport.evidence : [];
      evidence.slice(0, MAX_EVIDENCE_PER_PASSPORT).forEach((item: any, evidenceIndex) => {
        const id = `evidence:${passport.id}:${String(item.id || evidenceIndex)}`;
        addNode({ id, label: short(item.name, 'Evidence'), kind: 'evidence', detail: `${safeText(item.status, 'status unavailable')} · ${safeText(item.type, 'record')}`, meta: [item.hash && `hash ${String(item.hash)}`, item.signer && `signer ${String(item.signer)}`, item.timestamp && `observed ${String(item.timestamp)}`].filter(Boolean).join(' · ') || undefined, x: 1070, y: 45 + ((passportIndex * 5 + evidenceIndex) % 9) * 72 });
        addEdge(passportId, id, 'supports');
      });

      const components = Array.isArray(passport.sbom) ? passport.sbom : [];
      const vulnerableNames = new Set((passport.vulnerabilities || []).map((item: any) => item.component));
      const riskComponents = components.filter((item: any) => item.trustLevel !== 'Trusted' || vulnerableNames.has(item.name));
      // Rendering every SBOM component would overwhelm the graph for large
      // manifests, so only components that are flagged or tied to a known
      // vulnerability get their own node — the rest are summarized in the
      // passport's own detail text rather than fabricated as "safe" nodes.
      const shownComponents = riskComponents.slice(0, MAX_COMPONENTS_PER_PASSPORT);
      shownComponents.forEach((component: any, componentIndex) => {
        const id = `component:${passport.id}:${slug(component.name || String(componentIndex))}`;
        addNode({ id, label: short(component.name, 'Component'), kind: 'component', detail: `${safeText(component.dependencyType, 'dependency')} · ${safeText(component.trustLevel, 'trust level unavailable')}`, meta: component.purl ? String(component.purl) : undefined, x: 650, y: 50 + ((passportIndex * 3 + componentIndex) % 9) * 72 });
        addEdge(passportId, id, 'contains');
      });
      const trustedHidden = components.length - riskComponents.length;
      const riskHidden = riskComponents.length - shownComponents.length;
      if (trustedHidden > 0 || riskHidden > 0) {
        const passportNode = graphNodes.find((node) => node.id === passportId);
        if (passportNode) {
          const notes = [
            trustedHidden > 0 && `${trustedHidden} additional trusted component${trustedHidden === 1 ? '' : 's'} not shown`,
            riskHidden > 0 && `${riskHidden} further flagged component${riskHidden === 1 ? '' : 's'} not shown`,
          ].filter(Boolean);
          passportNode.detail = `${passportNode.detail} · ${notes.join(' · ')}`;
        }
      }

      (passport.vulnerabilities || []).slice(0, MAX_VULNERABILITIES_PER_PASSPORT).forEach((vuln: any, vulnIndex) => {
        const id = `vulnerability:${passport.id}:${String(vuln.id || vulnIndex)}`;
        addNode({ id, label: short(vuln.title || vuln.component, 'Vulnerability'), kind: 'vulnerability', detail: `${safeText(vuln.severity, 'severity unavailable')} · ${safeText(vuln.status, 'status unavailable')}`, meta: [vuln.cvss != null && `CVSS ${String(vuln.cvss)}`, vuln.fixedVersion && `fix ${String(vuln.fixedVersion)}`, vuln.description && String(vuln.description)].filter(Boolean).join(' · ') || undefined, x: 1360, y: 50 + (vulnIndex % 9) * 72 });
        const matched = riskComponents.find((component: any) => component.name === vuln.component);
        if (matched) addEdge(`component:${passport.id}:${slug(matched.name || '')}`, id, 'affected by'); else addEdge(passportId, id, 'has vulnerability');
      });
    });

    findings.forEach((raw, index) => {
      const finding = raw as GraphFinding; const id = `finding:${String(finding.id || index)}`;
      addNode({ id, label: short(finding.title || finding.control_id, 'Finding'), kind: 'finding', detail: `${safeText(finding.severity, 'severity unavailable')} · ${safeText(finding.status, 'status unavailable')}`, meta: finding.description, x: 950, y: 70 + (index % 9) * 72 });
      const passportId = finding.passport_id || finding.passportId;
      if (passportId && passports.some((passport) => passport.id === passportId)) addEdge(`passport:${passportId}`, id, 'has finding');
      else if (finding.asset_id && assets.some((asset) => asset.id === finding.asset_id)) addEdge(`asset:${finding.asset_id}`, id, 'has finding');
      else if (finding.client_id && clients.some((client) => client.id === finding.client_id)) addEdge(`client:${finding.client_id}`, id, 'has finding');
    });

    return { nodes: graphNodes, edges: graphEdges, truncated: graphNodes.length >= MAX_NODES };
  }, [assets, clients, findings, passports]);

  const needle = query.trim().toLowerCase();
  const matchingIds = useMemo(() => new Set(nodes.filter((node) => {
    if (kindFilter !== 'all' && node.kind !== kindFilter) return false;
    if (!needle) return true;
    return `${node.label} ${node.detail} ${node.meta || ''}`.toLowerCase().includes(needle);
  }).map((node) => node.id)), [kindFilter, needle, nodes]);
  const visibleNodes = useMemo(() => {
    if (!showOnlyConnected || !selectedId) return nodes.filter((node) => matchingIds.has(node.id));
    const ids = new Set<string>([selectedId]);
    edges.forEach((edge) => { if (edge.source === selectedId) ids.add(edge.target); if (edge.target === selectedId) ids.add(edge.source); });
    return nodes.filter((node) => matchingIds.has(node.id) && ids.has(node.id));
  }, [edges, matchingIds, nodes, selectedId, showOnlyConnected]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), [edges, visibleIds]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedEdge = selectedEdgeKey ? edges.find((edge) => edgeKey(edge) === selectedEdgeKey) : undefined;
  const activeId = hoveredId || selectedId;
  const activeNeighbors = useMemo(() => {
    if (!activeId) return null;
    const ids = new Set<string>([activeId]);
    visibleEdges.forEach((edge) => { if (edge.source === activeId) ids.add(edge.target); if (edge.target === activeId) ids.add(edge.source); });
    return ids;
  }, [activeId, visibleEdges]);
  const connectedEdges = selected ? visibleEdges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];

  const selectNode = (id: string) => { setSelectedId(id); setSelectedEdgeKey(null); };
  const selectEdge = (edge: GraphEdge) => { setSelectedEdgeKey(edgeKey(edge)); setSelectedId(null); };
  const zoomBy = (factor: number) => setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  const resetView = () => setView({ x: 0, y: 0, k: 1 });
  const onWheel = (event: WheelEvent<SVGSVGElement>) => { event.preventDefault(); zoomBy(event.deltaY > 0 ? 0.9 : 1.1); };
  const onPointerDown = (event: MouseEvent<SVGSVGElement>) => { dragRef.current = { x: event.clientX, y: event.clientY }; draggedRef.current = false; };
  const onPointerMove = (event: MouseEvent<SVGSVGElement>) => { if (!dragRef.current) return; const dx = event.clientX - dragRef.current.x; const dy = event.clientY - dragRef.current.y; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) draggedRef.current = true; dragRef.current = { x: event.clientX, y: event.clientY }; setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy })); };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <section className="space-y-5" aria-labelledby="trust-graph-title">
      <header className="spr-panel p-5 lg:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-sky-300"><Share2 className="h-4 w-4" aria-hidden="true" /> Trust graph</div>
            <h1 id="trust-graph-title" className="mt-2 text-3xl font-semibold tracking-tight">Observed relationships</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--spr-text-muted)]">Explore the evidence graph without turning a name match into a trust claim. Every relationship is tied to an explicit persisted relationship or an observed evidence collection.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-[var(--spr-border)] px-3 py-2"><div className="text-lg font-semibold">{nodes.length}</div><div className="text-[var(--spr-text-muted)]">Nodes</div></div>
            <div className="rounded-lg border border-[var(--spr-border)] px-3 py-2"><div className="text-lg font-semibold">{edges.length}</div><div className="text-[var(--spr-text-muted)]">Relationships</div></div>
            <div className="rounded-lg border border-[var(--spr-border)] px-3 py-2"><div className="text-lg font-semibold">{visibleNodes.length}</div><div className="text-[var(--spr-text-muted)]">Visible</div></div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative min-w-0"><Search size={16} className="absolute left-3 top-3 text-[var(--spr-text-muted)]" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search software, client, evidence, finding…" aria-label="Search trust graph" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-2.5 pl-9 pr-9 text-sm text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)] focus:border-[var(--spr-highlight)]/50" />{query && <button onClick={() => setQuery('')} aria-label="Clear graph search" className="absolute right-2 top-2 rounded-lg p-1 text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]"><X size={15} /></button>}</label>
          <label className="flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 text-sm"><Filter size={15} aria-hidden="true" /><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | GraphKind)} aria-label="Filter graph by node type" className="bg-transparent py-2.5 text-sm text-[var(--spr-text)] outline-none"><option value="all">All node types</option>{KIND_ORDER.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select></label>
          <button type="button" onClick={() => setShowOnlyConnected((value) => !value)} disabled={!selectedId} className="rounded-md border border-[var(--spr-border)] px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" aria-pressed={showOnlyConnected}><Network className="mr-2 inline h-4 w-4" aria-hidden="true" /> Connected only</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--spr-text-muted)]">{KIND_ORDER.map((kind) => <span key={kind} className={`rounded-full border px-2 py-1 ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>)}{truncated && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-300">Graph capped at {MAX_NODES} nodes</span>}</div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="spr-panel relative overflow-hidden" role="application" aria-label="Interactive software trust graph">
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)]/90 p-1 shadow-lg backdrop-blur">
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in" className="rounded-md p-2 hover:bg-[var(--spr-surface-deep)]"><ZoomIn size={16} /></button>
            <button type="button" onClick={() => zoomBy(0.83)} aria-label="Zoom out" title="Zoom out" className="rounded-md p-2 hover:bg-[var(--spr-surface-deep)]"><ZoomOut size={16} /></button>
            <button type="button" onClick={resetView} aria-label="Reset graph view" title="Reset graph view" className="rounded-md p-2 hover:bg-[var(--spr-surface-deep)]"><Maximize2 size={16} /></button>
          </div>
          <div className="min-h-[620px] overflow-hidden bg-[radial-gradient(circle_at_center,rgba(148,163,184,.07),transparent_58%)]">
            <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="h-[620px] w-full cursor-grab touch-none active:cursor-grabbing" onWheel={onWheel} onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp} aria-label="Trust relationship graph">
              <defs><pattern id="trust-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeOpacity=".06" strokeWidth="1" /></pattern></defs>
              <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="url(#trust-grid)" />
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {visibleEdges.map((edge) => {
                  const source = nodeById.get(edge.source); const target = nodeById.get(edge.target); if (!source || !target) return null;
                  const active = selectedEdgeKey === edgeKey(edge); const dimmed = Boolean(activeId && !activeNeighbors?.has(source.id) && !activeNeighbors?.has(target.id));
                  return <g key={edgeKey(edge)} className="cursor-pointer" onClick={(event) => { event.stopPropagation(); if (!draggedRef.current) selectEdge(edge); }}><line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="currentColor" strokeOpacity={dimmed ? .06 : active ? .8 : .2} strokeWidth={active ? 3 : 1.5} />{active && <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 7} textAnchor="middle" className="fill-[var(--spr-text)] text-[11px] font-medium">{edge.label}</text>}</g>;
                })}
                {visibleNodes.map((node) => {
                  const selectedNode = selectedId === node.id; const active = activeId === node.id; const dimmed = Boolean(activeId && !activeNeighbors?.has(node.id));
                  return <g key={node.id} transform={`translate(${node.x} ${node.y})`} className="cursor-pointer" opacity={dimmed ? .2 : 1} tabIndex={0} role="button" aria-label={`${KIND_LABEL[node.kind]}: ${node.label}`} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)} onClick={(event) => { event.stopPropagation(); if (!draggedRef.current) selectNode(node.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } }}><circle r={selectedNode ? 25 : active ? 22 : 19} fill="var(--spr-surface)" stroke="currentColor" strokeOpacity={selectedNode ? .95 : .45} strokeWidth={selectedNode ? 3 : 2} /><circle r="7" fill="currentColor" opacity=".8" /><text y="38" textAnchor="middle" className="fill-[var(--spr-text)] text-[12px] font-medium">{node.label}</text><text y="53" textAnchor="middle" className="fill-[var(--spr-text-muted)] text-[9px]">{KIND_LABEL[node.kind]}</text></g>;
                })}
              </g>
            </svg>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--spr-border)] px-4 py-3 text-xs text-[var(--spr-text-muted)]"><span>Drag to pan · wheel to zoom · click a node or relationship</span><span>{Math.round(view.k * 100)}% zoom</span></div>
        </div>

        <aside className="spr-panel min-h-[620px] p-5" aria-label="Trust graph inspector">
          {selected ? <div>
            <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${KIND_CLASS[selected.kind]}`}>{KIND_LABEL[selected.kind]}</div>
            <h2 className="mt-3 text-xl font-semibold">{selected.label}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{selected.detail}</p>
            {selected.meta && <div className="mt-3 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-xs leading-5 text-[var(--spr-text-muted)] break-words">{selected.meta}</div>}
            <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold">Direct relationships</h3><span className="text-xs text-[var(--spr-text-muted)]">{connectedEdges.length}</span></div>
            <div className="mt-2 space-y-2">{connectedEdges.length === 0 && <p className="rounded-lg border border-dashed border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]">No visible direct relationships.</p>}{connectedEdges.map((edge) => { const otherId = edge.source === selected.id ? edge.target : edge.source; const other = nodeById.get(otherId); return <button key={edgeKey(edge)} type="button" onClick={() => selectEdge(edge)} className="w-full rounded-lg border border-[var(--spr-border)] p-3 text-left hover:border-[var(--spr-highlight)]/40"><div className="text-xs font-semibold">{edge.label}</div><div className="mt-1 text-sm">{other?.label || 'Unknown record'}</div><div className="mt-1 text-[11px] text-[var(--spr-text-muted)]">{other ? KIND_LABEL[other.kind] : 'Record unavailable'}</div></button>; })}</div>
          </div> : selectedEdge ? <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">Relationship</div><h2 className="mt-3 text-xl font-semibold">{selectedEdge.label}</h2>
            <div className="mt-4 space-y-2 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-sm"><div><span className="text-[var(--spr-text-muted)]">From:</span> {nodeById.get(selectedEdge.source)?.label || 'Unknown'}</div><div><span className="text-[var(--spr-text-muted)]">To:</span> {nodeById.get(selectedEdge.target)?.label || 'Unknown'}</div></div>
            <div className="mt-4 flex gap-2 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-xs leading-5 text-[var(--spr-text-muted)]"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" /><span>{EDGE_RATIONALE[selectedEdge.label] || 'The relationship is present in the loaded graph data.'}</span></div>
            <button type="button" onClick={() => setSelectedEdgeKey(null)} className="mt-4 rounded-md border border-[var(--spr-border)] px-3 py-2 text-sm hover:bg-[var(--spr-surface-deep)]">Back to graph</button>
          </div> : <div className="flex h-full min-h-[580px] flex-col items-center justify-center text-center"><div className="rounded-full border border-sky-400/20 bg-sky-400/10 p-4"><Share2 className="h-6 w-6 text-sky-300" aria-hidden="true" /></div><h2 className="mt-4 text-lg font-semibold">Graph inspector</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[var(--spr-text-muted)]">Select a node to inspect its record and direct relationships, or select a line to see why SPR drew it.</p></div>}
        </aside>
      </div>

      <footer className="spr-panel flex flex-col gap-3 p-4 text-xs text-[var(--spr-text-muted)] sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Observed relationships are not certification claims. UNKNOWN remains valid when the graph lacks authoritative evidence.</span></div><div className="flex items-center gap-2 whitespace-nowrap"><Network size={14} aria-hidden="true" /> Evidence-first graph</div></footer>
    </section>
  );
}
