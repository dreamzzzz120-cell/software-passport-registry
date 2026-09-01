import { useMemo, useState } from 'react';
import { Bot, Copy } from 'lucide-react';

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

  return (
    <section aria-labelledby="agent-trust-title">
      <div className="mb-4">
        <h1 id="agent-trust-title" className="flex items-center gap-1.5 text-[22px] font-semibold text-[#201f1e]"><Bot className="h-4 w-4 text-[#605e5c]" />Agent Trust API</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Let MCP-compatible AI agents verify software against SPR evidence instead of relying on unsupported AI claims.</p>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>SPR exposes a read-only MCP/JSON-RPC surface so agents can check claims against evidence instead of guessing.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Point an MCP-compatible agent at the endpoint below.</li>
            <li>Call a tool such as <code>verify_software</code> with a signed Passport reference.</li>
            <li>SPR returns VERIFIED, CONTRADICTED, or UNVERIFIED — missing evidence stays unverified.</li>
          </ol>
        </div>
      </details>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><div className="text-[11px] text-[#605e5c]">Transport</div><div className="mt-1 text-[15px] font-semibold text-[#201f1e]">MCP / JSON-RPC</div><div className="mt-1 text-[11px] text-[#8a8886]">Read-only agent surface</div></div>
        <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><div className="text-[11px] text-[#605e5c]">Endpoint</div><div className="mt-1 break-all font-mono text-[12px] text-[#201f1e]">{endpoint}</div><button type="button" onClick={() => void copy(endpoint)} className="mt-2 inline-flex h-7 items-center gap-1 rounded border border-[#c8c6c4] px-2 text-[11px] font-medium text-[#323130] hover:bg-black/[.03]"><Copy className="h-3 w-3" />{copied ? 'Copied' : 'Copy endpoint'}</button></div>
        <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><div className="text-[11px] text-[#605e5c]">Trust rule</div><div className="mt-1 text-[15px] font-semibold text-[#201f1e]">Evidence first</div><div className="mt-1 text-[11px] text-[#8a8886]">Missing evidence stays unverified.</div></div>
      </div>

      <section className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
        <h2 className="text-[14px] font-semibold text-[#201f1e]">Available agent tools</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{tools.map(([name, description]) => <div key={name} className="rounded border border-[#e1dfdd] bg-[#faf9f8] p-3"><div className="font-mono text-[12px] text-[#0f6cbd]">{name}</div><p className="mt-1 text-[12px] text-[#605e5c]">{description}</p></div>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Verify a Passport</h2>
          <p className="mt-1 text-[12px] text-[#605e5c]">Paste a signed public Passport reference to prepare an agent verification request.</p>
          <input value={passport} onChange={e => setPassport(e.target.value.slice(0, 512))} placeholder="Signed Passport token or URL" className="mt-3 h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
          <pre className="mt-3 max-h-64 overflow-auto rounded border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[11px] text-[#323130]">{example}</pre>
          <button type="button" onClick={() => void copy(example)} className="mt-2 inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]">{copied ? 'Copied' : 'Copy JSON-RPC request'}</button>
        </div>
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Verify a claim</h2>
          <p className="mt-1 text-[12px] text-[#605e5c]">SPR deliberately returns UNVERIFIED when observed evidence does not support the claim.</p>
          <input value={claim} onChange={e => setClaim(e.target.value.slice(0, 2000))} placeholder="Example: this software has current security evidence" className="mt-3 h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
          <div className="mt-3 rounded-md border border-[#f5dfa0] bg-[#fff4ce] p-3 text-[13px] text-[#8a5700]">Claim: {claim || 'Enter a claim to send to an MCP-compatible agent.'}</div>
        </div>
      </section>
    </section>
  );
}
