export type AIProvenance = {
  model: string;
  modelVersion: string;
  promptVersion: string;
  evidenceIds: string[];
  generatedAt: string;
};

export function validateAIProvenance(value: unknown): value is AIProvenance {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.model === 'string' && v.model.length > 0 &&
    typeof v.modelVersion === 'string' && v.modelVersion.length > 0 &&
    typeof v.promptVersion === 'string' && v.promptVersion.length > 0 &&
    Array.isArray(v.evidenceIds) && v.evidenceIds.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof v.generatedAt === 'string' && !Number.isNaN(Date.parse(v.generatedAt));
}
