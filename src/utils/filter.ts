/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computes the Levenshtein distance between two strings.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Checks if query matches text using weight-based sequential matching and
 * a sliding window Levenshtein distance algorithm for high-quality, typo-tolerant search.
 */
export function fuzzyMatch(text: string | null | undefined, query: string | null | undefined): boolean {
  if (!query) return true;
  if (!text) return false;

  const t = text.toLowerCase().trim();
  const q = query.toLowerCase().trim();

  if (q === '') return true;

  // 1. Direct Substring Check (covers most standard cases, very fast)
  if (t.includes(q)) return true;

  // 2. Word-by-word check
  const qWords = q.split(/\s+/).filter(Boolean);
  if (qWords.length > 1) {
    const allWordsMatch = qWords.every((word) => t.includes(word));
    if (allWordsMatch) return true;
  }

  // 3. Sequential character match
  let queryIdx = 0;
  for (let textIdx = 0; textIdx < t.length; textIdx++) {
    if (t[textIdx] === q[queryIdx]) {
      queryIdx++;
      if (queryIdx === q.length) {
        return true;
      }
    }
  }

  // 4. Sliding window Levenshtein distance (for typo tolerance)
  if (q.length >= 3) {
    const windowSize = q.length;
    // Check if any substring of target with similar length has a small distance
    for (let i = 0; i <= t.length - windowSize; i++) {
      const sub = t.substring(i, i + windowSize);
      const dist = levenshteinDistance(sub, q);
      // Allow 1 typo for length 3-5, 2 typos for 6+
      const allowedDist = q.length <= 5 ? 1 : 2;
      if (dist <= allowedDist) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filters a list of items using the fuzzy matching algorithm across multiple keys/fields.
 */
export function filterData<T>(
  data: T[],
  query: string | null | undefined,
  keys: (keyof T)[]
): T[] {
  if (!query) return data;
  return data.filter((item) => {
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
