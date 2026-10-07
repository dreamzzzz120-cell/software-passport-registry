/** Allow only SQLSTATE in diagnostics; error text can contain private SQL values. */
export function databaseErrorCode(error: unknown): string {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : null;
  for (const candidate of [cause, error]) {
    const code = candidate && typeof candidate === 'object' && 'code' in candidate ? candidate.code : null;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return 'UNKNOWN';
}
