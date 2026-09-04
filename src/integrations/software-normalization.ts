export type SoftwareObservation = {
  name: string;
  publisher?: string | null;
  version?: string | null;
  productCode?: string | null;
  packageId?: string | null;
  source?: string | null;
};

export type NormalizedSoftware = {
  canonicalName: string;
  publisher: string | null;
  version: string | null;
  confidence: number;
  disposition: 'matched' | 'review' | 'unknown';
  matchedBy: string[];
  aliases: string[];
};

const ALIASES: Record<string, { canonicalName: string; publisher: string }> = {
  'microsoft 365': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
  'microsoft office 365': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
  'm365': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
  'm365 pro': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
  'office 365': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
  'ms 365': { canonicalName: 'Microsoft 365', publisher: 'Microsoft' },
};

function clean(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[®™]/g, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}

function publisherCompatible(observed: string, expected: string): boolean {
  if (!observed) return true;
  const a = clean(observed), b = clean(expected);
  return a === b || a.includes(b) || b.includes(a);
}

export function normalizeSoftware(observation: SoftwareObservation): NormalizedSoftware {
  const raw = clean(observation?.name);
  const publisher = observation?.publisher?.trim() || null;
  const version = observation?.version?.trim() || null;
  if (!raw) {
    return {
      canonicalName: 'Unknown software',
      publisher,
      version,
      confidence: 0,
      disposition: 'unknown',
      matchedBy: [],
      aliases: [],
    };
  }

  const direct = ALIASES[raw];
  if (direct) {
    const publisherOk = publisherCompatible(publisher || '', direct.publisher);
    const confidence = publisherOk ? 0.97 : 0.78;
    return {
      canonicalName: direct.canonicalName,
      publisher: direct.publisher,
      version,
      confidence,
      disposition: confidence >= 0.9 ? 'matched' : 'review',
      matchedBy: ['normalized-alias', ...(publisherOk ? ['publisher'] : [])],
      aliases: [observation.name],
    };
  }

  if (publisher) {
    return {
      canonicalName: observation.name.trim(),
      publisher,
      version,
      confidence: 0.72,
      disposition: 'review',
      matchedBy: ['publisher-plus-name'],
      aliases: [],
    };
  }

  return {
    canonicalName: observation.name.trim(),
    publisher,
    version,
    confidence: 0.35,
    disposition: 'unknown',
    matchedBy: [],
    aliases: [],
  };
}

export function shouldAutoMatch(result: NormalizedSoftware, minimumConfidence = 0.9): boolean {
  return result.disposition === 'matched' && result.confidence >= minimumConfidence;
}
