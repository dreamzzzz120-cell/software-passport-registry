// Single source of truth for the accent color assigned to each feature/nav
// item, shared between the sidebar (CommandCenter.tsx) and each feature's own
// page header, so a feature reads as the same color everywhere it appears.
// Colors are drawn from the VS Code Dark+ token palette in src/index.css.
export const BLUE = '#3794ff';
export const CYAN = '#9cdcfe';
export const TEAL = '#4ec9b0';
export const GREEN = '#89d185';
export const AMBER = '#cca700';
export const RED = '#f14c4c';
export const PURPLE = '#c586c0';
export const ORANGE = '#ce9178';

export const FEATURE_COLORS: Record<string, string> = {
  dashboard: BLUE,
  assets: CYAN,
  passports: AMBER,
  coverage: GREEN,
  'evidence-explorer': TEAL,
  scans: ORANGE,
  monitoring: BLUE,
  alerts: RED,
  clients: PURPLE,
  'trust-graph': CYAN,
  security: RED,
  compliance: GREEN,
  'audit-log': ORANGE,
  vendors: PURPLE,
  integrations: TEAL,
  reports: BLUE,
  msp: PURPLE,
  'agent-trust': CYAN,
  'ai-trust-center': BLUE,
  'enterprise-readiness': AMBER,
  investor: GREEN,
  founder: RED,
  team: TEAL,
  extensions: PURPLE,
  billing: AMBER,
  settings: CYAN,
};
