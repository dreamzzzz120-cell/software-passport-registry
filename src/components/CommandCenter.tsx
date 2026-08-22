import type { Key, ReactNode } from 'react';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';

type NavItem = { id: string; label: string; icon: string; path: string };

const CORE: NavItem[] = [
  { id: 'dashboard', label: 'Command Center', icon: '⌂', path: '/dashboard' },
  { id: 'assets', label: 'Assets', icon: '◈', path: '/assets' },
  { id: 'passports', label: 'Passports', icon: '◇', path: '/passports' },
  { id: 'scans', label: 'Scans', icon: '⌁', path: '/scans' },
  { id: 'monitoring', label: 'Monitoring', icon: '◉', path: '/monitoring' },
  { id: 'alerts', label: 'Alerts', icon: '!', path: '/alerts' },
  { id: 'clients', label: 'Clients', icon: '◎', path: '/clients' },
];
const GOVERNANCE: NavItem[] = [
  { id: 'security', label: 'Security', icon: '⌾', path: '/security' },
  { id: 'compliance', label: 'Compliance', icon: '✓', path: '/compliance' },
  { id: 'vendors', label: 'Vendors', icon: '◫', path: '/vendors' },
  { id: 'integrations', label: 'Integrations', icon: '↔', path: '/integrations' },
];
const EXECUTIVE: NavItem[] = [
  { id: 'msp', label: 'MSP Command', icon: '▦', path: '/msp' },
  { id: 'agent-trust', label: 'AI Agent Trust', icon: 'AI', path: '/agent-trust' },
  { id: 'enterprise-readiness', label: 'Enterprise Readiness', icon: 'ER', path: '/enterprise-readiness' },
  { id: 'investor', label: 'Investor View', icon: 'IV', path: '/investor' },
  { id: 'founder', label: 'Founder Dashboard', icon: 'FD', path: '/founder' },
];
const SYSTEM: NavItem[] = [
  { id: 'extensions', label: 'Extension Marketplace', icon: 'EX', path: '/extensions' },
  { id: 'billing', label: 'Billing', icon: '$', path: '/billing' },
  { id: 'settings', label: 'Settings', icon: '⚙', path: '/settings' },
];

type NavButtonProps = { item: NavItem; active: boolean; onNavigate: (path: string) => void; key?: Key };
function NavButton({ item, active, onNavigate }: NavButtonProps) {
  return <button onClick={() => onNavigate(item.path)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? 'border border-cyan-300/20 bg-cyan-300/10 text-white shadow-[0_0_28px_rgba(34,211,238,.08)]' : 'text-slate-400 hover:bg-white/[.045] hover:text-white'}`}><span className={`grid h-7 w-7 place-items-center rounded-lg border text-[10px] font-semibold ${active ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[.025] text-slate-500 group-hover:text-slate-200'}`}>{item.icon}</span><span className="flex-1">{item.label}</span>{active && <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.9)]" />}</button>;
}

type ExtensionButtonProps = { extension: ExtensionDefinition; active: boolean; onNavigate: (path: string) => void; key?: Key };
function ExtensionButton({ extension, active, onNavigate }: ExtensionButtonProps) {
  return <button onClick={() => onNavigate(extension.entryPath)} className={`group w-full rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-violet-300/25 bg-violet-300/10' : 'border-transparent hover:border-white/10 hover:bg-white/[.04]'}`}><div className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-lg border border-violet-300/20 bg-violet-300/10 text-[10px] font-bold text-violet-200">EX</span><span className="min-w-0 flex-1 truncate text-sm text-slate-300 group-hover:text-white">{extension.shortName}</span><span className="text-[10px] text-slate-600">→</span></div></button>;
}

export default function CommandCenter({ children, path, userEmail, role, onNavigate, onSignOut }: { children: ReactNode; path: string; userEmail?: string | null; role: string; onNavigate: (path: string) => void; onSignOut: () => void }) {
  const extensionActive = path.startsWith('/extensions/');
  const active = (candidate: string) => path === candidate || (candidate !== '/dashboard' && path.startsWith(`${candidate}/`));
  const mobileItems = [...CORE.slice(0, 4), ...EXECUTIVE.slice(0, 2), ...EXTENSIONS.map((extension) => ({ id: extension.id, label: extension.shortName, icon: 'EX', path: extension.entryPath }))];
  return <div className="min-h-screen overflow-hidden bg-[#05070d] text-white"><div className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(circle_at_15%_5%,rgba(34,211,238,.10),transparent_28%),radial-gradient(circle_at_90%_15%,rgba(139,92,246,.10),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,.06),transparent_35%)]" /><div className="relative z-10 flex min-h-screen">
    <aside className="hidden w-[280px] shrink-0 border-r border-white/[.07] bg-black/30 p-4 backdrop-blur-2xl lg:flex lg:flex-col"><button onClick={() => onNavigate('/dashboard')} className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3 text-left shadow-2xl"><span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-xs font-black text-cyan-200 shadow-[0_0_30px_rgba(34,211,238,.12)]">SPR</span><span className="min-w-0"><span className="block text-sm font-semibold">Software Passport</span><span className="block text-[11px] text-slate-500">Trust operating system</span></span></button><div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-slate-600">Core workflow</div><nav className="space-y-1">{CORE.map((item) => <NavButton key={item.id} item={item} active={active(item.path)} onNavigate={onNavigate} />)}</nav><div className="mb-3 mt-6 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-slate-600">Governance</div><nav className="space-y-1">{GOVERNANCE.map((item) => <NavButton key={item.id} item={item} active={active(item.path)} onNavigate={onNavigate} />)}</nav><div className="mb-3 mt-6 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-slate-600">Executive workflows</div><nav className="space-y-1">{EXECUTIVE.map((item) => <NavButton key={item.id} item={item} active={active(item.path)} onNavigate={onNavigate} />)}</nav><div className="mb-3 mt-6 flex items-center justify-between px-2"><span className="text-[10px] font-bold uppercase tracking-[.22em] text-slate-600">Extensions</span><span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[9px] text-violet-200">{EXTENSIONS.length}</span></div><nav className="space-y-1">{EXTENSIONS.map((extension) => <ExtensionButton key={extension.id} extension={extension} active={extensionActive && path === extension.entryPath} onNavigate={onNavigate} />)}</nav><div className="mt-auto space-y-1 border-t border-white/[.07] pt-4">{SYSTEM.map((item) => <NavButton key={item.id} item={item} active={active(item.path)} onNavigate={onNavigate} />)}</div></aside>
    <main className="min-w-0 flex-1"><header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#05070d]/75 px-4 py-3 backdrop-blur-2xl md:px-7"><div className="flex items-center gap-3"><button onClick={() => onNavigate('/dashboard')} className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-[10px] font-black text-cyan-200 lg:hidden">SPR</button><div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-slate-600">Secure workspace</div><div className="truncate text-sm text-slate-200">{extensionActive ? 'Extension workflow' : 'Software trust command center'}</div></div><div className="hidden items-center gap-2 md:flex"><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[.05] px-2.5 py-1 text-[10px] font-semibold text-cyan-200">● AUTHENTICATED</span><span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[10px] text-slate-400">{role}</span></div><div className="hidden max-w-[190px] truncate text-xs text-slate-500 xl:block">{userEmail || 'Authenticated user'}</div><button onClick={onSignOut} className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[.06] hover:text-white">Sign out</button></div></header>
      <div className="border-b border-white/[.06] bg-black/20 px-3 py-2 backdrop-blur-xl lg:hidden"><div className="flex gap-2 overflow-x-auto pb-0.5">{mobileItems.map((item) => <button key={item.id} onClick={() => onNavigate(item.path)} className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] ${active(item.path) ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200' : 'border-white/[.07] bg-white/[.025] text-slate-500'}`}>{item.icon !== 'EX' ? `${item.icon} ` : ''}{item.label}</button>)}</div></div>
      <div className="mx-auto max-w-[1600px] p-4 md:p-7">{children}</div></main>
  </div></div>;
}
