/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The `clients` table stores four collections as JSON-stringified TEXT
// columns (src/db/schema.ts:48-51, migrations/0000 line 51):
//
//   software_inventory, compliance_status, team_members, activity_timeline
//
// The API selected them with a plain alias, so they reached the browser as
// raw JSON *strings* while src/types.ts declared them as arrays. Every
// consumer therefore called array methods on a string:
//
//   PassportsView:  (c.softwareInventory || []).some(...)
//     -> TypeError: .some is not a function   (crashed /passports)
//   ClientsView:    client.complianceStatus.map(...)
//     -> TypeError: .map is not a function    (crashed /clients)
//
// `|| []` never helped: a JSON string is truthy, and even the column's
// default '[]' is a two-character truthy string. Worse than the crashes,
// `.length` silently succeeded and returned the *string* length, so
// pdfGenerator reported "PASSPORTS IN USE: 2" for an empty inventory.
//
// These helpers make the shape canonical at the boundary rather than
// patching each call site with optional chaining, which would have left
// the wrong-number bugs in place.

/** A plain, non-array object with at least one own property. */
function isPopulatedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length > 0;
}

/**
 * Coerces a JSON-array text column into a real array.
 *
 * Handles, in order: an already-parsed array (passed through untouched),
 * NULL/undefined, empty or whitespace-only text, valid JSON text, and a
 * driver that already parsed the column into an object.
 *
 * A parsed value that is a single populated object is wrapped as one
 * element rather than dropped, so a legacy single-entry row is preserved.
 * Anything genuinely uninterpretable (invalid JSON, a bare number/boolean,
 * an empty object) becomes an empty array: per the evidence-first rule,
 * unknown stays unknown and nothing is ever fabricated to make a screen
 * render.
 */
export function toJsonArrayColumn<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (Array.isArray(parsed)) return parsed as T[];
    if (isPopulatedObject(parsed)) return [parsed as T];
    return [];
  }

  if (isPopulatedObject(value)) return [value as T];
  return [];
}

/** The client fields persisted as JSON-array text columns. */
export const CLIENT_JSON_ARRAY_FIELDS = [
  'softwareInventory',
  'complianceStatus',
  'teamMembers',
  'activityTimeline',
] as const;

/**
 * Returns a copy of a client row with all four JSON-array columns coerced
 * to real arrays. Safe to apply more than once (it is idempotent), which is
 * why it is used at both the API serializer and the browser boundary.
 */
export function normalizeClientRecord<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const normalized: Record<string, any> = { ...row };
  for (const field of CLIENT_JSON_ARRAY_FIELDS) {
    normalized[field] = toJsonArrayColumn(row[field]);
  }
  return normalized as T;
}

export function normalizeClientRecords<T extends Record<string, any>>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeClientRecord(row as T));
}

/**
 * The passport fields persisted as JSON-array text columns
 * (src/db/schema.ts:78-81).
 *
 * `evidence` and `vulnerabilities` are deliberately absent: GET
 * /user/passports builds those with json_agg, so the driver already returns
 * real arrays. `sbom` and `timeline` are selected as plain text columns and
 * arrived as JSON strings.
 *
 * That was worse than the client crash rather than better. The browser
 * guarded them with `Array.isArray(row.sbom) ? row.sbom : []`, which does
 * not throw - it silently replaced the parsed SBOM with an empty array, so
 * the component inventory of every Software Passport rendered as empty.
 */
export const PASSPORT_JSON_ARRAY_FIELDS = ['sbom', 'timeline'] as const;

export function normalizePassportRecord<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const normalized: Record<string, any> = { ...row };
  for (const field of PASSPORT_JSON_ARRAY_FIELDS) {
    normalized[field] = toJsonArrayColumn(row[field]);
  }
  return normalized as T;
}

export function normalizePassportRecords<T extends Record<string, any>>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizePassportRecord(row as T));
}
