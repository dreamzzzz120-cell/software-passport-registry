/** Validate the server profile before presenting a workspace role. */
const ROLES = new Set(['Owner', 'Admin', 'Operator', 'Technician', 'Viewer', 'Client']);

export function workspaceIdentity(value: unknown, expectedUid: string): { role: string; isFounder: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  if (profile.uid !== expectedUid || typeof profile.tenantId !== 'string' || !profile.tenantId.trim()) return null;
  if (typeof profile.role !== 'string' || !ROLES.has(profile.role)) return null;
  return { role: profile.role, isFounder: profile.isFounder === true };
}
