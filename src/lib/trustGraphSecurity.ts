export type TrustGraphRelationship = 'owns' | 'contains' | 'supports' | 'has finding' | 'affected by' | 'has vulnerability';

/**
 * Trust Graph invariant: relationships must be backed by persisted identity or
 * authoritative collection membership. Names, labels, versions, PURLs, and
 * array positions are never relationship keys.
 */
export function persistedIdentity(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return id || null;
}

export function explicitComponentReference(vulnerability: unknown): string | null {
  if (!vulnerability || typeof vulnerability !== 'object') return null;
  const record = vulnerability as Record<string, unknown>;
  return persistedIdentity(record.componentId) ?? persistedIdentity(record.component_id);
}

export function canRelateComponentToVulnerability(component: unknown, vulnerability: unknown): boolean {
  const componentRecord = component && typeof component === 'object' ? component as Record<string, unknown> : null;
  const componentId = componentRecord && (persistedIdentity(componentRecord.id) ?? persistedIdentity(componentRecord.componentId));
  const vulnerabilityComponentId = explicitComponentReference(vulnerability);
  return Boolean(componentId && vulnerabilityComponentId && componentId === vulnerabilityComponentId);
}
