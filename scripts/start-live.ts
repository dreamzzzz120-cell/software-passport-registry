import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: false });

await import('../server.ts');
