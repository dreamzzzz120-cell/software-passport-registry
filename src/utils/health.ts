export type DatabaseHealth =
  | { db: 'connected'; code: 'DB_CONNECTED' }
  | { db: 'unavailable'; code: 'DB_MISCONFIGURED' | 'DB_TIMEOUT' | 'DB_UNAVAILABLE' };

export async function probeDatabase(
  query: () => Promise<unknown>,
  configured: boolean,
  timeoutMs = 2_000
): Promise<DatabaseHealth> {
  if (!configured) {
    return { db: 'unavailable', code: 'DB_MISCONFIGURED' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Database probe timed out'), { code: 'DB_TIMEOUT' })), timeoutMs);
      })
    ]);
    return { db: 'connected', code: 'DB_CONNECTED' };
  } catch (error: any) {
    return {
      db: 'unavailable',
      code: error?.code === 'DB_TIMEOUT' ? 'DB_TIMEOUT' : 'DB_UNAVAILABLE'
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
