import { useState, type Key, type ReactNode } from 'react';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';
import { AMBER, BLUE, CYAN, GREEN, ORANGE, PURPLE, RED, TEAL } from '../workflows/featureColors';

type NavItem = { id: string; label: string; icon: string; path: string; color: string; desc: string };

// A distinct accent per feature so the sidebar reads at a glance instead of
// as a wall of identically-gray glyphs — see workflows/featureColors.ts,
// which is also used by each feature's own page header so the same feature
// reads as the same color everywhere it appears.

const CORE: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: '⌂', path: '/dashboard', color: BLUE, desc: 'Workspace summary — key metrics across passports, evidence, and alerts at a glance.' },
  { id: 'assets', label: 'Assets', icon: '◈', path: '/assets', color: CYAN, desc: 'The software assets you track — services, applications, and components under management.' },
  { id: 'passports', label: 'Passports', icon: '◇', path: '/passports', color: AMBER, desc: 'Software Passports — structured records combining identity, security, and evidence for a piece of software.' },
  { id: 'coverage', label: 'Evidence coverage', icon: '▤', path: '/coverage', color: GREEN, desc: 'How much of your inventory has verifiable evidence versus self-attested claims.' },
  { id: 'evidence-explorer', label: 'Evidence Explorer', icon: '⛾', path: '/evidence-explorer', color: TEAL, desc: 'Browse and search the underlying evidence records collected for your passports.' },
  { id: 'scans', label: 'Scans', icon: '⌁', path: '/scans', color: ORANGE, desc: 'SBOM and vulnerability scans run against your assets.' },
  { id: 'monitoring', label: 'Monitoring', icon: '◉', path: '/monitoring', color: BLUE, desc: 'Live monitoring signals for tracked assets and integrations.' },
  { id: 'alerts', label: 'Alerts', icon: '!', path: '/alerts', color: RED, desc: 'Active findings and notifications that need attention.' },
  { id: 'clients', label: 'Clients', icon: '◎', path: '/clients', color: PURPLE, desc: 'Organizations and teams you manage passports and evidence for.' },
  { id: 'trust-graph', label: 'Trust Graph', icon: '◌', path: '/trust-graph', color: CYAN, desc: 'A relationship graph connecting assets, vendors, and evidence.' },
];
const GOVERNANCE: NavItem[] = [
  { id: 'security', label: 'Security', icon: '⌾', path: '/security', color: RED, desc: 'Security posture and findings across your tracked software.' },
  { id: 'compliance', label: 'Compliance', icon: '✓', path: '/compliance', color: GREEN, desc: 'Compliance status against the frameworks and policies you track.' },
  { id: 'audit-log', label: 'Audit Log', icon: '▥', path: '/audit-log', color: ORANGE, desc: 'A chronological record of actions taken in this workspace.' },
  { id: 'vendors', label: 'Vendors', icon: '◫', path: '/vendors', color: PURPLE, desc: 'Third-party vendors and suppliers whose software you assess.' },
  { id: 'integrations', label: 'Integrations', icon: '↔', path: '/integrations', color: TEAL, desc: 'Connected tools and data sources feeding evidence into SPR.' },
  { id: 'reports', label: 'Reports Center', icon: '▤', path: '/reports', color: BLUE, desc: 'Generated reports summarizing trust, compliance, and evidence.' },
];
const EXECUTIVE: NavItem[] = [
  { id: 'msp', label: 'MSP Command', icon: '▦', path: '/msp', color: PURPLE, desc: 'Cross-client oversight for managed service providers.' },
  { id: 'agent-trust', label: 'AI Agent Trust', icon: 'AI', path: '/agent-trust', color: CYAN, desc: 'Trust posture for AI agents operating in your environment.' },
  { id: 'ai-trust-center', label: 'AI Trust Center', icon: 'AI', path: '/ai-trust-center', color: BLUE, desc: 'Centralized view of AI-related trust and governance signals.' },
  { id: 'enterprise-readiness', label: 'Enterprise Readiness', icon: 'ER', path: '/enterprise-readiness', color: AMBER, desc: 'Readiness checklist for enterprise buyers and procurement.' },
  { id: 'investor', label: 'Investor View', icon: 'IV', path: '/investor', color: GREEN, desc: 'A read-only summary view built for investor updates.' },
  { id: 'founder', label: 'Founder Dashboard', icon: 'FD', path: '/founder', color: RED, desc: 'Founder-only internal metrics and controls.' },
];
const SYSTEM: NavItem[] = [
  { id: 'team', label: 'Team', icon: '♙', path: '/team', color: TEAL, desc: 'Manage teammates and their roles in this workspace.' },
  { id: 'extensions', label: 'Extension Marketplace', icon: 'EX', path: '/extensions', color: PURPLE, desc: 'Optional workflow extensions you can add to SPR.' },
  { id: 'billing', label: 'Billing', icon: '$', path: '/billing', color: AMBER, desc: 'Subscription plan and billing details.' },
  { id: 'settings', label: 'Settings', icon: '⚙', path: '/settings', color: CYAN, desc: 'Workspace configuration and preferences.' },
];

const EXTENSION_ACCENTS: Record<string, string> = { cyan: BLUE, violet: PURPLE, fuchsia: '#d16d9e', amber: AMBER, emerald: GREEN };

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
                title={item.desc}
                className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
                style={active ? undefined : { color: 'var(--spr-text)' }}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center text-[10px]" style={{ color: item.color }}>{item.icon}</span>
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
  const color = EXTENSION_ACCENTS[extension.accent] ?? '#9d9d9d';
  return (
    <button
      onClick={() => onNavigate(extension.entryPath)}
      data-active={active}
      title={extension.description}
      className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
      style={active ? undefined : { color: 'var(--spr-text)' }}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border text-[8px] font-bold" style={{ borderColor: color, color }}>EX</span>
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
            title="Go to the Overview dashboard."
            className="mb-3 flex items-center gap-2.5 rounded-md border border-[#3c3c3c] p-2 text-left hover:bg-[#252526] focus:outline-none focus:ring-2 focus:ring-[#3794ff]/40"
          >
            <img src="/brand/spr-badge.jpg" alt="SPR" className="h-9 w-9 shrink-0 rounded-md border border-[#3c3c3c] object-cover" />
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
            <span title={`${EXTENSIONS.length} extension${EXTENSIONS.length === 1 ? '' : 's'} installed in this workspace.`} className="rounded-sm border border-[#3c3c3c] px-1.5 text-[9px] text-[#9d9d9d]">{EXTENSIONS.length}</span>
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
                title={item.desc}
                className="spr-nav-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]"
                style={active(item.path) ? undefined : { color: 'var(--spr-text)' }}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center text-[10px]" style={{ color: item.color }}>{item.icon}</span>
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
                title="Go to the Overview dashboard."
                className="rounded-md border border-[#3c3c3c] focus:outline-none focus:ring-2 focus:ring-[#3794ff]/40 lg:hidden"
              >
                <img src="/brand/spr-badge.jpg" alt="SPR" className="h-7 w-7 rounded-md object-cover" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#6f6f6f]">
                  <span>Workspace</span>
                  <span>/</span>
                  <span className="font-medium text-[#d4d4d4]">{currentLabel}</span>
                </div>
              </div>
              <span title="This session is connected to live workspace data." className="hidden items-center gap-1.5 rounded-sm border border-[#3c3c3c] px-2 py-0.5 text-[11px] text-[#9d9d9d] md:flex">
                <span className="spr-status-dot spr-status-dot--green" /> Live
              </span>
              <span title="Your role in this workspace, which controls what you can view and change." className="hidden rounded-sm border border-[#3c3c3c] px-2 py-0.5 text-[11px] text-[#9d9d9d] md:inline">{role}</span>
              <span title="The account you're signed in as." className="hidden max-w-[180px] truncate text-[11px] text-[#6f6f6f] xl:inline">{userEmail || 'Authenticated user'}</span>
              <button
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-expanded={mobileMenuOpen}
                aria-label="Open workspace navigation"
                title="Open the full navigation menu."
                className="spr-btn spr-btn-secondary !py-1 !px-2.5 !text-[11px] lg:hidden"
              >
                {mobileMenuOpen ? 'Close' : 'Menu'}
              </button>
              <button onClick={onSignOut} title="Sign out of your SPR account." className="spr-btn spr-btn-secondary !py-1 !px-2.5 !text-[11px]">Sign out</button>
            </div>
          </header>

          <div className="border-b border-[#3c3c3c] bg-[#252526] px-2 py-1.5 lg:hidden">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {mobileItems.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onNavigate(item.path); setMobileMenuOpen(false); }}
                  data-active={active(item.path)}
                  title={'desc' in item ? item.desc : undefined}
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
                    title={'desc' in item ? item.desc : undefined}
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
