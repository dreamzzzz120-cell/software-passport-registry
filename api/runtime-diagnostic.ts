export const config = { maxDuration: 30 };

export default async function handler(_req: unknown, res: any) {
  const stages: string[] = [];
  try {
    stages.push('config'); await import('../src/config.ts');
    stages.push('db'); await import('../src/db/index.ts');
    stages.push('security'); await import('../src/middleware/security.ts');
    stages.push('auth-route'); await import('../src/routes/auth.ts');
    stages.push('billing-route'); await import('../src/routes/billing.ts');
    stages.push('scans-route'); await import('../src/routes/scans.ts');
    stages.push('server'); await import('../server.ts');
    stages.push('complete');
    return res.status(200).json({ ok: true, stages });
  } catch (error) {
    const e = error as { name?: string; message?: string; code?: string };
    return res.status(500).json({ ok: false, stages, error: { name: e?.name ?? 'Error', code: e?.code ?? null, message: e?.message ?? String(error) } });
  }
}
