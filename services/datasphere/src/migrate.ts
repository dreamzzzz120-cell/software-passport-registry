import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL_REQUIRED');
const sql=postgres(url,{prepare:false,max:1,connect_timeout:10});
try{
  const migration=await readFile(new URL('../migrations/001_init.sql',import.meta.url),'utf8');
  await sql.unsafe(migration);
  console.log('DATASPHERE_MIGRATION_OK');
}finally{
  await sql.end({timeout:5});
}
