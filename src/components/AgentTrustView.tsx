import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';

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
    <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.25em] text-[#9cdcfe]"><Bot className="h-4 w-4" /> AI TRUST LAYER</div><h1 className="mt-2 text-3xl font-bold">Agent Trust API</h1><p className="mt-2 max-w-3xl text-[#9d9d9d]">Let MCP-compatible AI agents verify software against SPR evidence instead of relying on unsupported AI claims.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="spr-panel p-5"><div className="text-sm text-[#89d185]">Transport</div><div className="mt-2 text-xl font-semibold">MCP / JSON-RPC</div><div className="mt-1 text-xs text-[#9d9d9d]">Read-only agent surface</div></div>
      <div className="spr-panel p-5"><div className="text-sm text-[#3794ff]">Endpoint</div><div className="mt-2 break-all text-sm font-mono">{endpoint}</div><button onClick={() => void copy(endpoint)} className="spr-btn spr-btn-secondary mt-3 !py-1.5 !px-3 !text-xs">{copied ? 'Copied' : 'Copy endpoint'}</button></div>
      <div className="spr-panel p-5"><div className="text-sm text-[#d4d4d4]">Trust rule</div><div className="mt-2 text-xl font-semibold">Evidence first</div><div className="mt-1 text-xs text-[#9d9d9d]">Missing evidence stays unverified.</div></div>
    </div>
    <section className="spr-panel p-5"><h2 className="text-lg font-semibold">Available agent tools</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{tools.map(([name, description]) => <div key={name} className="rounded-md border border-[#3c3c3c] p-4"><div className="font-mono text-sm text-[#3794ff]">{name}</div><p className="mt-1 text-sm text-[#9d9d9d]">{description}</p></div>)}</div></section>
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="spr-panel p-5"><h2 className="text-lg font-semibold">Verify a Passport</h2><p className="mt-1 text-sm text-[#9d9d9d]">Paste a signed public Passport reference to prepare an agent verification request.</p><input value={passport} onChange={e => setPassport(e.target.value.slice(0, 512))} placeholder="Signed Passport token or URL" className="mt-4 w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm outline-none focus:border-[#3794ff]" /><pre className="mt-4 max-h-64 overflow-auto rounded-md bg-[#2d2d2d] p-4 text-xs text-[#d4d4d4]">{example}</pre><button onClick={() => void copy(example)} className="spr-btn spr-btn-primary mt-3">{copied ? 'Copied' : 'Copy JSON-RPC request'}</button></div>
      <div className="spr-panel p-5"><h2 className="text-lg font-semibold">Verify a claim</h2><p className="mt-1 text-sm text-[#9d9d9d]">SPR deliberately returns UNVERIFIED when observed evidence does not support the claim.</p><input value={claim} onChange={e => setClaim(e.target.value.slice(0, 2000))} placeholder="Example: this software has current security evidence" className="mt-4 w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm outline-none focus:border-[#3794ff]" /><div className="mt-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-4 text-sm text-[#cca700]">Claim: {claim || 'Enter a claim to send to an MCP-compatible agent.'}</div></div>
    </section>
  </div>;
}
