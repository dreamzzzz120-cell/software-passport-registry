import { describe, expect, it } from 'vitest';
import { EXTENSIONS, EXTENSION_BY_ID } from '../src/workflows/extensionRegistry';

describe('universal passport extensions', () => {
  it('registers product and AI passports in the canonical extension registry', () => {
    const product = EXTENSION_BY_ID['product-passport'];
    const ai = EXTENSION_BY_ID['ai-passport'];

    expect(product).toBeDefined();
    expect(ai).toBeDefined();
    expect(product.entryPath).toBe('/extensions/product-passport');
    expect(ai.entryPath).toBe('/extensions/ai-passport');
  });

  it('routes both extensions through canonical SPR evidence surfaces', () => {
    for (const id of ['product-passport', 'ai-passport']) {
      const extension = EXTENSION_BY_ID[id];
      expect(extension.steps.length).toBeGreaterThanOrEqual(4);
      expect(extension.sourceRoutes).toContain('/passports');
      expect(extension.sourceRoutes).toContain('/evidence-explorer');
      expect(extension.sourceRoutes).toContain('/monitoring');
    }
  });

  it('keeps the registry free of duplicate extension ids', () => {
    const ids = EXTENSIONS.map((extension) => extension.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
