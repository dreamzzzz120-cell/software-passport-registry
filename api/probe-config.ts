import { config } from '../src/config.ts';

export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, stage: 'config', production: config.isProduction });
}
