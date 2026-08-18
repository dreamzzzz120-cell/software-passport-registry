import React, { useState } from 'react';
import {
  ArrowRight, BarChart3, CheckCircle2, FileSearch, Handshake,
  Mail, SearchCheck, ShieldQuestion, Store,
  Tag, Workflow, XCircle
} from 'lucide-react';

const observed = [
  'The authorized GitHub repository coordinates and requested ref',
  'The exact commit SHA resolved or supplied for the scan',
  'Supported manifest and lockfile paths found in the selected directory',
  'Components and versions produced by Syft in CycloneDX JSON',
  'Responses returned by OSV for versioned observed components',
  'Byte-integrity of evidence persisted by SPR'
];

const notClaimed = [
  'That every dependency, vulnerability, or source file was discoverable',
  'That an external provider response is correct or exhaustive',
  'That payload integrity proves the underlying evidence is semantically true',
  'That a clean provider response proves an application has no security risk',
  'That a scan is a certification, penetration test, or compliance attestation'
];

const deliverables = [
  { title: 'Repository identity', detail: 'Provider, owner, repository, requested ref, exact commit SHA, subdirectory, and scan timestamps.' },
  { title: 'Observed inventory', detail: 'Discovered manifest and lockfile paths, plus explicit acquisition and observation limits.' },
  { title: 'SBOM summary', detail: 'Syft version, CycloneDX format, component counts, versions, digest, and integrity state.' },
  { title: 'OSV evidence', detail: 'Query and evidence counts, observed package versions, provider identifiers, findings, and timestamps.' }
];

const comparison = [
  ['Primary object', 'A point-in-time vulnerability result', 'A repository snapshot tied to an exact commit'],
  ['Inventory', 'Often starts from a package or image list', 'Records discovered manifests and a generated SBOM'],
  ['Evidence history', 'Usually centered on current findings', 'Preserves source, timestamps, payload digest, state, and limitations'],
  ['Clean result language', 'May be summarized as a clean bill of health', 'Reports only what the configured provider returned at scan time'],
  ['MSP conversation', 'Fix the current findings', 'Operate recurring supply-chain visibility, review, and remediation']
];

export default function PartnerProgramView() {
  const [form, setForm] = useState({ name: '', company: '', email: '', repositories: '1' });

  const submitApplication = (event: React.FormEvent) => {
    event.preventDefault();
    const subject = encodeURIComponent('SPR Founding MSP Pilot application');
    const body = encodeURIComponent(
      `Name: ${form.name}\nMSP: ${form.company}\nEmail: ${form.email}\nAuthorized repositories: ${form.repositories}\n\nI would like to discuss the controlled SPR Founding MSP Pilot.`
    );
    window.location.href = `mailto:stackdigitz@gmail.com?subject=${subject}&body=${body}`;
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-16 text-slate-700 dark:text-slate-200">
      <section className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-6 py-14 text-white shadow-xl md:px-12">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative max-w-4xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-indigo-200">
            <Handshake className="h-4 w-4" /> SPR Partner Program
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            Sell software supply-chain visibility as a managed service.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
            SPR turns an authorized repository into an evidence-backed client conversation: exact commit identity,
            discovered manifests, a Syft SBOM, OSV observations, and a customer-readable report.
          </p>
          <p className="mt-5 border-l-2 border-indigo-400 pl-4 font-mono text-sm text-indigo-100">
            “If SPR cannot observe it, SPR does not claim it.”
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => scrollTo('partner-application')} className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-400">
              Apply for Founding MSP Pilot
            </button>
            <a href="mailto:stackdigitz@gmail.com?subject=SPR%20MSP%20demo" className="rounded-xl border border-slate-500 px-5 py-3 text-sm font-bold hover:bg-white/10">
              Book a Demo
            </a>
            <button onClick={() => scrollTo('sample-report')} className="rounded-xl border border-slate-500 px-5 py-3 text-sm font-bold hover:bg-white/10">
              View Sample Report
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {[
          { icon: Store, title: 'Create recurring revenue', copy: 'Package repository onboarding, periodic reviews, evidence interpretation, remediation coordination, and client reporting into a managed service.' },
          { icon: BarChart3, title: 'Give clients a reason to renew', copy: 'Clients receive a dated record of what was observed, what changed, what the provider returned, and what remains unknown.' },
          { icon: Workflow, title: 'Keep delivery bounded', copy: 'SPR performs acquisition, manifest discovery, SBOM generation, OSV queries, evidence persistence, and report assembly. The MSP reviews and advises.' }
        ].map(({ icon: Icon, title, copy }) => (
          <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Icon className="h-7 w-7 text-indigo-500" />
            <h2 className="mt-4 text-lg font-black text-slate-900 dark:text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{copy}</p>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-7">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-indigo-500">Three-step workflow</span>
          <h2 className="mt-2 text-3xl font-black text-slate-950 dark:text-white">From authorization to client review</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['01', 'Authorize and observe', 'Select an authorized repository, ref, and optional subdirectory. SPR resolves the immutable commit and discovers supported manifests.'],
            ['02', 'Generate evidence', 'The independent worker generates a CycloneDX SBOM, queries OSV for versioned components, and stores evidence with explicit limitations.'],
            ['03', 'Review and advise', 'Open the tenant-scoped report, explain findings and unknowns, agree remediation work, then start a new scan when a fresh observation is needed.']
          ].map(([number, title, copy]) => (
            <div key={number} className="relative border-l border-indigo-200 pl-5 dark:border-indigo-900">
              <span className="font-mono text-sm font-black text-indigo-500">{number}</span>
              <h3 className="mt-2 font-black text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-2xl font-black text-slate-950 dark:text-white">Client deliverables</h2>
          <div className="mt-6 space-y-4">
            {deliverables.map(item => (
              <div key={item.title} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div><h3 className="font-bold">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{item.detail}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-7 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <Tag className="h-6 w-6 text-amber-600" />
            <h2 className="text-2xl font-black text-slate-950 dark:text-white">MSP branding</h2>
          </div>
          <span className="mt-5 inline-flex rounded-full bg-amber-200 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-900">Planned</span>
          <p className="mt-4 leading-7 text-slate-700 dark:text-slate-300">
            White-label and co-branded report templates are not currently verified as a production capability.
            Current reports carry SPR’s evidence language. The pilot will use SPR-branded reports while MSP template,
            logo, and contact-detail controls are developed and validated.
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-7 dark:border-emerald-900 dark:bg-emerald-950/20">
          <h2 className="flex items-center gap-3 text-2xl font-black text-slate-950 dark:text-white"><SearchCheck className="text-emerald-600" /> What SPR observes</h2>
          <ul className="mt-6 space-y-3">{observed.map(item => <li key={item} className="flex gap-3 text-sm"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />{item}</li>)}</ul>
        </div>
        <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-7 dark:border-rose-900 dark:bg-rose-950/20">
          <h2 className="flex items-center gap-3 text-2xl font-black text-slate-950 dark:text-white"><ShieldQuestion className="text-rose-600" /> What SPR does not claim</h2>
          <ul className="mt-6 space-y-3">{notClaimed.map(item => <li key={item} className="flex gap-3 text-sm"><XCircle className="h-5 w-5 shrink-0 text-rose-600" />{item}</li>)}</ul>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="p-7"><h2 className="text-2xl font-black text-slate-950 dark:text-white">SPR compared with a standard vulnerability scanner</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-800">
              <tr><th className="p-4">Question</th><th className="p-4">Standard scanner</th><th className="p-4">SPR evidence workflow</th></tr>
            </thead>
            <tbody>{comparison.map(row => <tr key={row[0]} className="border-t border-slate-100 dark:border-slate-800">{row.map((cell, index) => <td key={cell} className={`p-4 ${index === 0 ? 'font-bold' : 'text-slate-600 dark:text-slate-400'}`}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section id="sample-report" className="rounded-3xl border border-indigo-200 bg-indigo-50/50 p-7 dark:border-indigo-900 dark:bg-indigo-950/20">
        <div className="flex items-center gap-3"><FileSearch className="h-7 w-7 text-indigo-600" /><h2 className="text-2xl font-black text-slate-950 dark:text-white">Sample report language</h2></div>
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-indigo-600">Clearly labeled sample — not a scan result</p>
        <div className="mt-5 rounded-2xl border border-indigo-200 bg-white p-5 text-sm leading-7 dark:border-indigo-900 dark:bg-slate-950">
          “No known vulnerabilities were returned by the configured provider for the observed components and versions at the time of the scan.”
        </div>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          A failed scan is shown as <strong>FAILED</strong> with its recorded error category. It does not produce a clean result.
          The MSP can correct authorization, acquisition, manifest, or generator issues and start a new scan.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-3xl bg-slate-950 p-8 text-white">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-indigo-300">Founding MSP pilot</span>
          <h2 className="mt-3 text-3xl font-black">A bounded thirty-day controlled pilot</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {['One MSP', 'Up to three authorized repositories', 'SBOM generation', 'OSV vulnerability visibility', 'Evidence-backed reports', 'Direct founder onboarding'].map(item => <li key={item} className="flex gap-2 text-sm text-slate-300"><CheckCircle2 className="h-5 w-5 text-indigo-400" />{item}</li>)}
          </ul>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-black text-slate-950 dark:text-white">Resellable service layers</h2>
          <div className="mt-5 space-y-4 text-sm">
            <p><strong>Available:</strong> onboarding, repository review, scan interpretation, evidence review, finding triage, and customer advisory.</p>
            <p><strong>MSP-delivered:</strong> patch planning, dependency upgrades, validation, exception management, and recurring client reviews.</p>
            <p><strong>Planned in SPR:</strong> repository schedules, automated alerts, co-branded exports, and integrated recurring billing.</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-2xl font-black text-slate-950 dark:text-white">Frequently asked questions</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {[
            ['How much work does this create?', 'SPR automates the observed pipeline. The MSP authorizes scope, reviews the evidence, communicates limitations, and delivers any remediation engagement.'],
            ['What if there are no findings?', 'The report uses the exact provider-scoped statement shown above and retains the scan timestamp, observed component versions, and unknown areas.'],
            ['What if a scan fails?', 'The job is marked FAILED with a recorded error. No clean result or successful evidence claim is created. Failed and stuck jobs are visible to administrators.'],
            ['Can I rescan?', 'Yes. A completed or failed observation can be followed by a new scan. Active duplicate requests are blocked to prevent duplicate work.'],
            ['Is this a penetration test?', 'No. It is repository supply-chain observation using supported manifests, Syft, OSV, and persisted evidence.'],
            ['Can reports carry my brand?', 'Not yet as a verified production feature. Co-branded and white-label templates are Planned.']
          ].map(([question, answer]) => <article key={question} className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/60"><h3 className="font-black">{question}</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{answer}</p></article>)}
        </div>
      </section>

      <section id="partner-application" className="rounded-3xl border border-indigo-200 bg-white p-7 shadow-sm dark:border-indigo-900 dark:bg-slate-900">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <Mail className="h-8 w-8 text-indigo-500" />
            <h2 className="mt-4 text-3xl font-black text-slate-950 dark:text-white">Apply for the Founding MSP Pilot</h2>
            <p className="mt-3 leading-7 text-slate-600 dark:text-slate-400">This form opens an email draft in your email application. It does not silently save or submit data to SPR.</p>
          </div>
          <form onSubmit={submitApplication} className="grid gap-4">
            <input required aria-label="Your name" placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-300 bg-transparent px-4 py-3 text-sm dark:border-slate-700" />
            <input required aria-label="MSP company" placeholder="MSP company" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="rounded-xl border border-slate-300 bg-transparent px-4 py-3 text-sm dark:border-slate-700" />
            <input required type="email" aria-label="Work email" placeholder="Work email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded-xl border border-slate-300 bg-transparent px-4 py-3 text-sm dark:border-slate-700" />
            <select aria-label="Repository count" value={form.repositories} onChange={e => setForm({ ...form, repositories: e.target.value })} className="rounded-xl border border-slate-300 bg-transparent px-4 py-3 text-sm dark:border-slate-700">
              <option value="1">One repository</option><option value="2">Two repositories</option><option value="3">Three repositories</option>
            </select>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-500">Apply for Founding MSP Pilot <ArrowRight className="h-4 w-4" /></button>
          </form>
        </div>
      </section>
    </div>
  );
}
