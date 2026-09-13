/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared by the registry crawler worker and the founder panel, so the
 * panel can name the language a cursor index points at without pulling
 * the worker (and its database client) into the browser bundle.
 */
export const CRAWL_LANGUAGES = ['JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'Rust', 'C#', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'C++', 'Scala', 'Dart', 'Elixir'] as const;
