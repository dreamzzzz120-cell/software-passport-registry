export default async function handler(_req: any, res: any) {
  const stages: string[] = [];
  try {
    await import('../src/config.ts'); stages.push('config');
    await import('../src/db/index.ts'); stages.push('db');
    await import('../src/security/index.ts').catch(() => { throw new Error('security-import-failed'); }); stages.push('security');
    res.status(200).json({ ok: true, stages });
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string };
    res.status(500).json({ ok: false, stages, error: { name: e?.name ?? 'Error', code: e?.code ?? null, message: e?.message ?? 'unknown' } });
  }
}
