/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Perform a fuzzy match check to see if a query matches a target string.
 * It is case-insensitive, prioritizes exact/substring matches, word-by-word matches,
 * and falls back to a sequential character match.
 */
export function fuzzyMatch(text: string | null | undefined, query: string | null | undefined): boolean {
  if (!query) return true;
  if (!text) return false;

  const cleanText = text.toLowerCase().trim();
  const cleanQuery = query.toLowerCase().trim();

  if (cleanQuery === '') return true;

  // 1. Direct Substring Check (covers most standard cases, very fast)
  if (cleanText.includes(cleanQuery)) return true;

  // 2. Word-by-word check: if the query consists of multiple words,
  // check if all of those query words exist in the text in any order
  const queryWords = cleanQuery.split(/\s+/).filter(Boolean);
  if (queryWords.length > 1) {
    const allWordsMatch = queryWords.every((word) => cleanText.includes(word));
    if (allWordsMatch) return true;
  }

  // 3. Sequential character match: characters of query must appear in sequence in target text
  let queryIdx = 0;
  for (let textIdx = 0; textIdx < cleanText.length; textIdx++) {
    if (cleanText[textIdx] === cleanQuery[queryIdx]) {
      queryIdx++;
      if (queryIdx === cleanQuery.length) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filters a list of items using fuzzy matching against multiple keys/fields.
 */
export function filterData<T>(
  items: T[],
  query: string | null | undefined,
  keys: (keyof T)[]
): T[] {
  if (!query) return items;
  return items.filter((item) => {
    return keys.some((key) => {
      const val = item[key];
      if (typeof val === 'string') {
        return fuzzyMatch(val, query);
      }
      if (typeof val === 'number' || typeof val === 'boolean') {
        return fuzzyMatch(String(val), query);
      }
      return false;
    });
  });
}

