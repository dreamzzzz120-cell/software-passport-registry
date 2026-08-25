export function componentIdentity(component: { name: string; version: string; ecosystem?: string }) {
  return `${String(component.ecosystem || 'npm').trim().toLowerCase()}|${component.name.trim().toLowerCase()}|${component.version.trim()}`;
}

export function vulnerabilityIdentity(input: { tenantId: string; passportId: string; vulnerabilityId: string; component: { name: string; version: string; ecosystem?: string } }) {
  return `${input.tenantId}|${input.passportId}|api.osv.dev|${input.vulnerabilityId.trim()}|${componentIdentity(input.component)}`;
}
