import '../src/config.ts';
import '../src/db/index.ts';

export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, stages: ['config', 'db'] });
}
