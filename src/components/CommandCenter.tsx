import { useState, type Key, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';

type NavItem = { id: string; label: string; icon: string; path: string; badge?: string };
type NavGroup = { title: string; items: NavItem[] };

const OVERVIEW: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: '⌂', path: '/dashboard' },
];
const SOFTWARE: NavItem[] = [
  { id: 'passports', label: 'Passports', icon: '◇', path: '/passports' },
  { id: 'scans', label: 'Scans', icon: '⌁', path: '/scans' },
  { id: 'assets', label: 'Assets', icon: '◈', path: '/assets' },
  { id: 'coverage', label: 'Evidence coverage', icon: '▤', path: '/coverage' },
];
const TRUST: NavItem[] = [
  { id: 'evidence-explorer', label: 'Evidence Explorer', icon: '⛾', path: '/evidence-explorer' },
  { id: 'trust-graph', label: 'Trust Graph', icon: '◌', path: '/trust-graph' },
  { id: 'alerts', label: 'Findings', icon: '!', path: '/alerts' },
  { id: 'security', label: 'Security', icon: '⌾', path: '/security' },
  { id: 'monitoring', label: 'Monitoring', icon: '◉', path: '/monitoring' },
];
const REPORTS: NavItem[] = [
  { id: 'reports', label: 'Reports Center', icon: '▤', path: '/reports' },
];
const INTEGRATIONS: NavItem[] = [
  { id: 'integrations', label: 'Integrations', icon: '↔', path: '/integrations' },
];
const COMPLIANCE: NavItem[] = [
  { id: 'compliance', label: 'Compliance', icon: '✓', path: '/compliance' },
  { id: 'audit-log', label: 'Audit Log', icon: '▥', path: '/audit-log' },
  { id: 'vendors', label: 'Vendors', icon: '◫', path: '/vendors' },
  { id: 'clients', label: 'Clients', icon: '◎', path: '/clients' },
];
const EXECUTIVE: NavItem[] = [
  { id: 'msp', label: 'MSP Command', icon: '▦', path: '/msp' },
  { id: 'agent-trust', label: 'AI Agent Trust', icon: 'AI', path: '/agent-trust' },
  { id: 'ai-trust-center', label: 'AI Trust Center', icon: 'AI', path: '/ai-trust-center' },
  { id: 'enterprise-readiness', label: 'Enterprise Readiness', icon: 'ER', path: '/enterprise-readiness' },
  { id: 'investor', label: 'Investor View', icon: 'IV', path: '/investor' },
  { id: 'founder', label: 'Founder Dashboard', icon: 'FD', path: '/founder' },
];
const ADMIN: NavItem[] = [
  { id: 'team', label: 'Team', icon: '♙', path: '/team' },
  { id: 'extensions', label: 'Extension Marketplace', icon: 'EX', path: '/extensions' },
  { id: 'billing', label: 'Billing', icon: '$', path: '/billing' },
  { id: 'settings', label: 'Settings', icon: '⚙', path: '/settings' },
];

type NavButtonProps = { item: NavItem; active: boolean; onNavigate: (path: string) => void; key?: Key };
function NavButton({ item, active, onNavigate }: NavButtonProps) {
  return (
    <button
      onClick={() => onNavigate(item.path)}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-[7px] text-left text-[13px] transition-colors ${active ? 'bg-[#eff6fc] font-semibold text-[#004578]' : 'text-[#323130] hover:bg-black/[.04]'}`}
    >
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-semibold ${active ? 'text-[#0f6cbd]' : 'text-[#605e5c]'}`}>{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge && <span className="shrink-0 rounded-full bg-[#f3f2f1] px-1.5 text-[10px] font-medium text-[#605e5c]">{item.badge}</span>}
    </button>
  );
}

type ExtensionButtonProps = { extension: ExtensionDefinition; active: boolean; onNavigate: (path: string) => void; key?: Key };
function ExtensionButton({ extension, active, onNavigate }: ExtensionButtonProps) {
  return (
    <button
      onClick={() => onNavigate(extension.entryPath)}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-[7px] text-left text-[13px] transition-colors ${active ? 'bg-[#eff6fc] font-semibold text-[#004578]' : 'text-[#323130] hover:bg-black/[.04]'}`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-bold text-[#605e5c]">EX</span>
      <span className="min-w-0 flex-1 truncate">{extension.shortName}</span>
    </button>
  );
}

function NavGroupBlock({ group, active, onNavigate, defaultOpen = true }: { group: NavGroup; active: (path: string) => boolean; onNavigate: (path: string) => void; defaultOpen?: boolean; key?: Key }) {
  const [open, setOpen] = useState(defaultOpen);
  if (group.items.length === 0) return null;
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#605e5c] hover:text-[#323130]"
        aria-expanded={open}
      >
        <span>{group.title}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <nav className="space-y-px px-1">{group.items.map((item) => <NavButton key={item.id} item={item} active={active(item.path)} onNavigate={onNavigate} />)}</nav>}
    </div>
  );
}

export default function CommandCenter({ children, path, userEmail, role, onNavigate, onSignOut }: { children: ReactNode; path: string; userEmail?: string | null; role: string; onNavigate: (path: string) => void; onSignOut: () => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const extensionActive = path.startsWith('/extensions/');
  const active = (candidate: string) => path === candidate || (candidate !== '/dashboard' && path.startsWith(`${candidate}/`));
  const executiveItems = role === 'Owner' ? EXECUTIVE : EXECUTIVE.filter((item) => item.id !== 'founder');
  const groups: NavGroup[] = [
    { title: 'Overview', items: OVERVIEW },
    { title: 'Software', items: SOFTWARE },
    { title: 'Trust', items: TRUST },
    { title: 'Reports', items: REPORTS },
    { title: 'Integrations', items: INTEGRATIONS },
    { title: 'Compliance', items: COMPLIANCE },
    { title: 'Executive', items: executiveItems },
    { title: 'Administration', items: ADMIN },
  ];
  const mobileItems = [...groups.flatMap((g) => g.items), ...EXTENSIONS.map((extension) => ({ id: extension.id, label: extension.shortName, icon: 'EX', path: extension.entryPath }))];
  const currentItem = groups.flatMap((g) => g.items).find((item) => active(item.path));
  const currentLabel = extensionActive ? 'Extension workflow' : currentItem?.label || 'Trust workspace';

  return (
    <div className="min-h-screen bg-[#faf9f8] text-[#201f1e]">
      <div className="flex min-h-screen">
        <aside className="hidden h-screen w-[224px] shrink-0 overflow-y-auto border-r border-[#e1dfdd] bg-[#f3f2f1] lg:sticky lg:top-0 lg:flex lg:flex-col">
          <button onClick={() => onNavigate('/dashboard')} aria-label="Go to overview" className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e1dfdd] px-3 text-left hover:bg-black/[.03]">
            <span className="grid h-6 w-6 place-items-center rounded bg-[#0f6cbd] text-[10px] font-bold text-white">S</span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] font-semibold">SPR</span>
              <span className="block text-[10px] text-[#605e5c]">Software Trust Registry</span>
            </span>
          </button>
          <div className="flex-1 overflow-y-auto py-2">
            {groups.map((group) => <NavGroupBlock key={group.title} group={group} active={active} onNavigate={onNavigate} />)}
            {EXTENSIONS.length > 0 && (
              <div className="mb-1">
                <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">
                  <span>Extensions</span>
                  <span className="rounded-full bg-white px-1.5 text-[10px] text-[#605e5c]">{EXTENSIONS.length}</span>
                </div>
                <nav className="space-y-px px-1">{EXTENSIONS.map((extension) => <ExtensionButton key={extension.id} extension={extension} active={extensionActive && path === extension.entryPath} onNavigate={onNavigate} />)}</nav>
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-[#e1dfdd] bg-white px-3 md:px-4">
            <button onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-label="Open navigation" className="rounded border border-[#e1dfdd] px-2 py-1 text-xs text-[#323130] lg:hidden">{mobileMenuOpen ? 'Close' : 'Menu'}</button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-[#605e5c]">
                <span>SPR</span><span>/</span><span className="truncate font-medium text-[#201f1e]">{currentLabel}</span>
              </div>
            </div>
            <span className="hidden items-center gap-1 rounded border border-[#e1dfdd] px-2 py-0.5 text-[11px] text-[#605e5c] sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0e700e]" /> Live
            </span>
            <span className="hidden rounded border border-[#e1dfdd] px-2 py-0.5 text-[11px] text-[#605e5c] md:inline">{role}</span>
            <span className="hidden max-w-[180px] truncate text-[12px] text-[#605e5c] xl:inline">{userEmail || 'Authenticated user'}</span>
            <button onClick={onSignOut} className="rounded border border-[#e1dfdd] px-2.5 py-1 text-[12px] text-[#323130] hover:bg-black/[.03]">Sign out</button>
          </header>

          {mobileMenuOpen && (
            <div className="border-b border-[#e1dfdd] bg-white px-3 py-2 lg:hidden">
              <div className="grid grid-cols-2 gap-1">
                {mobileItems.map((item) => (
                  <button key={item.id} onClick={() => { onNavigate(item.path); setMobileMenuOpen(false); }} className={`truncate rounded px-2.5 py-1.5 text-left text-[12px] ${active(item.path) ? 'bg-[#eff6fc] font-medium text-[#004578]' : 'text-[#323130]'}`}>{item.label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
