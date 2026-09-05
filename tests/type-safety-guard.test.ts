import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// The React error boundaries originally needed `as unknown as` casts to reach
// Component's inherited props/setState, because @types/react was not
// installed and `react` resolved to untyped JavaScript. That same gap is why
// a JSON string could sit in a field typed as an array until it crashed
// production. With the types installed the casts are unnecessary, so this
// guards both the dependency and the absence of the escape hatches.
describe('React typings remain installed', () => {
  it('pins @types/react and @types/react-dom to the React major in use', () => {
    const pkg = JSON.parse(read('package.json'));
    const dev = pkg.devDependencies ?? {};
    expect(dev['@types/react']).toBeDefined();
    expect(dev['@types/react-dom']).toBeDefined();

    const majorOf = (value: unknown) => {
      const match = String(value).match(/\d+/);
      return match?.[0] ?? null;
    };
    const reactMajor = majorOf(pkg.dependencies?.react);
    expect(reactMajor).not.toBeNull();
    expect(majorOf(dev['@types/react'])).toBe(reactMajor);
    expect(majorOf(dev['@types/react-dom'])).toBe(reactMajor);
  });
});

describe('the error boundaries use no type escape hatches', () => {
  const boundaries = ['src/components/ViewErrorBoundary.tsx', 'src/LazyApp.tsx'];

  it('contains no unsafe casts or suppression directives', () => {
    for (const file of boundaries) {
      const source = read(file);
      expect(source, file).not.toContain('as unknown as');
      expect(source, file).not.toContain('@ts-ignore');
      expect(source, file).not.toContain('@ts-expect-error');
      expect(source, file).not.toMatch(/:\s*any\b/);
    }
  });

  it('reads children from props rather than a constructor snapshot', () => {
    const lazyApp = read('src/LazyApp.tsx');
    expect(lazyApp).toContain('return this.props.children');
    expect(lazyApp).not.toMatch(/private\s+readonly\s+children/);
    expect(read('src/components/ViewErrorBoundary.tsx')).toContain('return this.props.children');
  });

  it('both boundaries still declare the React error-boundary contract', () => {
    for (const file of boundaries) {
      expect(read(file), file).toContain('static getDerivedStateFromError');
    }
  });
});
