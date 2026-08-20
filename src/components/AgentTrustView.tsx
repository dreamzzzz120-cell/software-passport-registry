import { useMemo, useState } from 'react';

const tools = [
  ['verify_software', 'Verify a Software Passport and its current evidence-backed status.'],
  ['get_passport', 'Retrieve the machine-readable public Passport.'],
  ['get_trust_evidence', 'Retrieve evidence supporting a trust determination.'],
  ['get_security_status', 'Return observed security evidence and status.'],
  ['get_compliance_status', 'Return only compliance claims supported by evidence.'],
  ['check_freshness', 'Check evidence freshness and staleness.'],
  ['verify_claim', 'Check a claim and return VERIFIED, CONTRADICTED, or UNVERIFIED.'],
] as const;

export default function AgentTrustView() {
  const [passport, setPassport] = useState('');
  const [claim, setClaim] = useState('');
  const [copied, setCopied] = useState(false);
  const endpoint = useMemo(() => `${window.location.origin}/mcp`, []);
  const example = useMemo(() => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_software', arguments: { passport: passport || 'YOUR_SIGNED_PASSPORT' } } }, null, 2), [passport]);
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };

  return <div className="mx-auto max-w-6xl space-y-6">
    <div><p className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">AI TRUST LAYER</p><h1 className="mt-2 text-3xl font-bold">Agent Trust API</h1><p className="mt-2 max-w-3xl text-slate-400">Let MCP-compatible AI agents verify software against SPR evidence instead of relying on unsupported AI claims.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-5"><div className="text-sm text-emerald-300">Transport</div><div className="mt-2 text-xl font-semibold">MCP / JSON-RPC</div><div className="mt-1 text-xs text-slate-400">Read-only agent surface</div></div>
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-5"><div className="text-sm text-cyan-300">Endpoint</div><div className="mt-2 break-all text-sm font-mono">{endpoint}</div><button onClick={() => void copy(endpoint)} className="mt-3 rounded-lg border border-white/10 px-3 py-1.5 text-xs">{copied ? 'Copied' : 'Copy endpoint'}</button></div>
      <div className="rounded-xl border border-white/10 bg-white/[.03] p-5"><div className="text-sm text-slate-300">Trust rule</div><div className="mt-2 text-xl font-semibold">Evidence first</div><div className="mt-1 text-xs text-slate-400">Missing evidence stays unverified.</div></div>
    </div>
    <section className="rounded-xl border border-white/10 bg-white/[.03] p-5"><h2 className="text-lg font-semibold">Available agent tools</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{tools.map(([name, description]) => <div key={name} className="rounded-lg border border-white/10 p-4"><div className="font-mono text-sm text-cyan-200">{name}</div><p className="mt-1 text-sm text-slate-400">{description}</p></div>)}</div></section>
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/[.03] p-5"><h2 className="text-lg font-semibold">Verify a Passport</h2><p className="mt-1 text-sm text-slate-400">Paste a signed public Passport reference to prepare an agent verification request.</p><input value={passport} onChange={e => setPassport(e.target.value.slice(0, 512))} placeholder="Signed Passport token or URL" className="mt-4 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-300" /><pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{example}</pre><button onClick={() => void copy(example)} className="mt-3 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">{copied ? 'Copied' : 'Copy JSON-RPC request'}</button></div>
      <div className="rounded-xl border border-white/10 bg-white/[.03] p-5"><h2 className="text-lg font-semibold">Verify a claim</h2><p className="mt-1 text-sm text-slate-400">SPR deliberately returns UNVERIFIED when observed evidence does not support the claim.</p><input value={claim} onChange={e => setClaim(e.target.value.slice(0, 2000))} placeholder="Example: this software has current security evidence" className="mt-4 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-300" /><div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">Claim: {claim || 'Enter a claim to send to an MCP-compatible agent.'}</div></div>
    </section>
  </div>;
}
