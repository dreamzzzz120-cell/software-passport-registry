import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Many contracts in this suite are asserted against implementation source
// rather than behaviour, and for the honesty guarantees that is deliberate:
// "this view states no price of its own" is a property of the file, and
// rendering the component would not check it.
//
// Asserting the raw text, though, also fails for reasons that have nothing to
// do with the guarantee. A re-wrapped argument list, a reformatted statement or
// a changed indent all break `toContain` while the promise the test protects is
// still perfectly intact. On 2026-09-03/04 that produced four separate red-main
// incidents in one evening -- seo-safety, security-contract, billing-contract
// and the MSP pricing contract -- each "fixed" by editing the test to match the
// new formatting, which is the habit that eventually lets a real regression
// through unread.
//
// Normalising every run of whitespace to a single space keeps the assertion
// exactly as strong (same tokens, same order, same file) while letting the code
// be formatted freely. Use `readCode` for the source under test and the `code`
// tag for the snippet, so both sides are normalised the same way.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const normalizeCode = (source: string) => source.replace(/\s+/g, ' ').trim();

/** Read a repository file with its whitespace normalised for contract matching. */
export const readCode = (relative: string) => normalizeCode(fs.readFileSync(path.join(root, relative), 'utf8'));

/** Read a repository file verbatim, for assertions that are about exact text. */
export const readRaw = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Tagged template that normalises a code snippet the same way `readCode` does. */
export const code = (strings: TemplateStringsArray, ...values: unknown[]) =>
  normalizeCode(String.raw({ raw: strings }, ...values));
