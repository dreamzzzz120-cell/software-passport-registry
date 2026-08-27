import { useState, type Key, type ReactNode } from 'react';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';

type NavItem = { id: string; label: string; icon: string; path: string };

const CORE: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: '⌂', path: '/dashboard' },
  { id: 'assets', label: 'Assets', icon: '◈', path: '/assets' },
  { id: 'passports', label: 'Passports', icon: '◇', path: '/passports' },
  { id: 'coverage', label: 'Evidence coverage', icon: '▤', path: '/coverage' },
  { id: 'evidence-explorer', label: 'Evidence Explorer', icon: '⛾', path: '/evidence-explorer' },
  { id: 'scans', label: 'Scans', icon: '⌁', path: '/scans' },
  { id: 'monitoring', label: 'Monitoring', icon: '◉', path: '/monitoring' },
  { id: 'alerts', label: 'Alerts', icon: '!', path: '/alerts' },
  { id: 'clients', label: 'Clients', icon: '◎', path: '/clients' },
  { id: 'trust-graph', label: 'Trust Graph', icon: '◌', path: '/trust-graph' },
];
const GOVERNANCE: NavItem[] = [
  { id: 'security', label: 'Security', icon: '⌾', path: '/security' },
  { id: 'compliance', label: 'Compliance', icon: '✓', path: '/compliance' },
  { id: 'audit-log', label: 'Audit Log', icon: '▥', path: '/audit-log' },
  { id: 'vendors', label: 'Vendors', icon: '◫', path: '/vendors' },
  { id: 'integrations', label: 'Integrations', icon: '↔', path: '/integrations' },
  { id: 'reports', label: 'Reports Center', icon: '▤', path: '/reports' },
];
const EXECUTIVE: NavItem[] = [
  { id: 'msp', label: 'MSP Command', icon: '▦', path: '/msp' },
  { id: 'agent-trust', label: 'AI Agent Trust', icon: 'AI', path: '/agent-trust' },
  { id: 'ai-trust-center', label: 'AI Trust Center', icon: 'AI', path: '/ai-trust-center' },
  { id: 'enterprise-readiness', label: 'Enterprise Readiness', icon: 'ER', path: '/enterprise-readiness' },
  { id: 'investor', label: 'Investor View', icon: 'IV', path: '/investor' },
  { id: 'founder', label: 'Founder Dashboard', icon: 'FD', path: '/founder' },
];
const SYSTEM: NavItem[] = [
  { id: 'team', label: 'Team', icon: '♙', path: '/team' },
  { id: 'extensions', label: 'Extension Marketplace', icon: 'EX', path: '/extensions' },
  { id: 'billing', label: 'Billing', icon: '$', path: '/billing' },
  { id: 'settings', label: 'Settings', icon: '⚙', path: '/settings' },
];

type Group = { label: string; items: NavItem[] };

function NavGroup({ group, activePath, onNavigate, defaultOpen }: { group: Group; activePath: (p: string) => boolean; onNavigate: (path: string) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasActive = group.items.some((item) => activePath(item.path));
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[.06em] text-[#6f6f6f] hover:text-[#d4d4d4]"
      >
        <span>{group.label}</span>
        <span className="text-[9px]">{open ? '▾' : '▸'}</span>
      </button>
      {(open || hasActive) && (
        <nav className="space-y-0.5">
          {group.items.map((item) => {
            const active = activePath(item.path);
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.path)}
                data-active={active}
                className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
                style={active ? undefined : { color: 'var(--spr-text)' }}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center text-[10px] text-[#6f6f6f]">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

type ExtensionButtonProps = { extension: ExtensionDefinition; active: boolean; onNavigate: (path: string) => void; key?: Key };
function ExtensionButton({ extension, active, onNavigate }: ExtensionButtonProps) {
  return (
    <button
      onClick={() => onNavigate(extension.entryPath)}
      data-active={active}
      className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
      style={active ? undefined : { color: 'var(--spr-text)' }}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-[#3c3c3c] text-[8px] font-bold text-[#9d9d9d]">EX</span>
      <span className="min-w-0 flex-1 truncate">{extension.shortName}</span>
    </button>
  );
}

export default function CommandCenter({ children, path, userEmail, role, onNavigate, onSignOut }: { children: ReactNode; path: string; userEmail?: string | null; role: string; onNavigate: (path: string) => void; onSignOut: () => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const extensionActive = path.startsWith('/extensions/');
  const active = (candidate: string) => path === candidate || (candidate !== '/dashboard' && path.startsWith(`${candidate}/`));
  const executiveItems = role === 'Owner' ? EXECUTIVE : EXECUTIVE.filter((item) => item.id !== 'founder');
  const mobileItems = [...CORE, ...GOVERNANCE, ...executiveItems, ...SYSTEM, ...EXTENSIONS.map((extension) => ({ id: extension.id, label: extension.shortName, icon: 'EX', path: extension.entryPath }))];
  const currentItem = [...CORE, ...GOVERNANCE, ...executiveItems, ...SYSTEM].find((item) => active(item.path));
  const currentLabel = extensionActive ? 'Extension workflow' : currentItem?.label || 'Trust workspace';

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4]">
      <div className="flex min-h-screen">
        <aside className="spr-nav hidden h-screen w-[240px] shrink-0 overflow-y-auto p-2.5 lg:sticky lg:top-0 lg:flex lg:flex-col">
          <button
            onClick={() => onNavigate('/dashboard')}
            aria-label="Open Overview"
            className="mb-3 flex items-center gap-2.5 rounded-md border border-[#3c3c3c] p-2 text-left hover:bg-[#252526] focus:outline-none focus:ring-2 focus:ring-[#3794ff]/40"
          >
            <span className="grid h-8 w-8 place-items-center rounded-md border border-[#3c3c3c] bg-[#094771] text-[10px] font-bold text-[#3794ff]">SPR</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight">Software Passport Registry</span>
              <span className="block text-[10px] leading-tight text-[#6f6f6f]">Software Trust OS</span>
            </span>
          </button>
          <NavGroup group={{ label: 'Core workflow', items: CORE }} activePath={active} onNavigate={onNavigate} defaultOpen />
          <NavGroup group={{ label: 'Governance', items: GOVERNANCE }} activePath={active} onNavigate={onNavigate} defaultOpen />
          <NavGroup group={{ label: 'Executive', items: executiveItems }} activePath={active} onNavigate={onNavigate} defaultOpen={false} />
          <div className="mb-1 mt-2 flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-[#6f6f6f]">
            <span>Extensions</span>
            <span className="rounded-sm border border-[#3c3c3c] px-1.5 text-[9px] text-[#9d9d9d]">{EXTENSIONS.length}</span>
          </div>
          <nav className="space-y-0.5">
            {EXTENSIONS.map((extension) => (
              <ExtensionButton key={extension.id} extension={extension} active={extensionActive && path === extension.entryPath} onNavigate={onNavigate} />
            ))}
          </nav>
          <div className="mt-auto space-y-0.5 border-t border-[#3c3c3c] pt-2">
            {SYSTEM.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.path)}
                data-active={active(item.path)}
                className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
                style={active(item.path) ? undefined : { color: 'var(--spr-text)' }}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center text-[10px] text-[#6f6f6f]">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 h-12 border-b border-[#3c3c3c] bg-[#1e1e1e]/95 px-4 backdrop-blur-none md:px-6">
            <div className="flex h-12 items-center gap-3">
              <button
                onClick={() => onNavigate('/dashboard')}
                aria-label="Open Overview"
                className="grid h-7 w-7 place-items-center rounded-md border border-[#3c3c3c] bg-[#094771] text-[9px] font-bold text-[#3794ff] focus:outline-none focus:ring-2 focus:ring-[#3794ff]/40 lg:hidden"
              >
                SPR
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#6f6f6f]">
                  <span>Workspace</span>
                  <span>/</span>
                  <span className="font-medium text-[#d4d4d4]">{currentLabel}</span>
                </div>
              </div>
              <span className="hidden items-center gap-1.5 rounded-sm border border-[#3c3c3c] px-2 py-0.5 text-[11px] text-[#9d9d9d] md:flex">
                <span className="spr-status-dot spr-status-dot--green" /> Live
              </span>
              <span className="hidden rounded-sm border border-[#3c3c3c] px-2 py-0.5 text-[11px] text-[#9d9d9d] md:inline">{role}</span>
              <span className="hidden max-w-[180px] truncate text-[11px] text-[#6f6f6f] xl:inline">{userEmail || 'Authenticated user'}</span>
              <button
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-expanded={mobileMenuOpen}
                aria-label="Open workspace navigation"
                className="spr-btn spr-btn-secondary !py-1 !px-2.5 !text-[11px] lg:hidden"
              >
                {mobileMenuOpen ? 'Close' : 'Menu'}
              </button>
              <button onClick={onSignOut} className="spr-btn spr-btn-secondary !py-1 !px-2.5 !text-[11px]">Sign out</button>
            </div>
          </header>

          <div className="border-b border-[#3c3c3c] bg-[#252526] px-2 py-1.5 lg:hidden">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {mobileItems.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onNavigate(item.path); setMobileMenuOpen(false); }}
                  data-active={active(item.path)}
                  className="spr-nav-item shrink-0 border border-[#3c3c3c] px-2.5 py-1.5 text-[11px]"
                >
                  {item.label}
                </button>
              ))}
              <button onClick={() => setMobileMenuOpen((open) => !open)} className="spr-btn spr-btn-secondary shrink-0 !py-1.5 !px-2.5 !text-[11px]">
                {mobileMenuOpen ? 'Less' : 'More'}
              </button>
            </div>
            {mobileMenuOpen && (
              <div className="mt-1.5 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto border-t border-[#3c3c3c] pt-1.5">
                {mobileItems.slice(8).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.path); setMobileMenuOpen(false); }}
                    data-active={active(item.path)}
                    className="spr-nav-item border border-[#3c3c3c] px-2.5 py-2 text-left text-[11px]"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
