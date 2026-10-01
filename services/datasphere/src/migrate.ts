import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const migrationUrl=process.env.MIGRATION_DATABASE_URL;
const runtimePassword=process.env.DATASPHERE_RUNTIME_PASSWORD;
if(!migrationUrl)throw new Error('MIGRATION_DATABASE_URL_REQUIRED');
if(!runtimePassword || runtimePassword.length<32)throw new Error('DATASPHERE_RUNTIME_PASSWORD_REQUIRED');

const sql=postgres(migrationUrl,{prepare:false,max:1,connect_timeout:10});

async function execFormatted(formatText:string,arg:string){
  const rows=await sql<{ddl:string}[]>`SELECT format(${formatText}::text, ${arg}::text) AS ddl`;
  if(!rows[0]?.ddl)throw new Error('DDL_FORMAT_FAILED');
  await sql.unsafe(rows[0].ddl);
}

try{
  const migration=await readFile(new URL('../migrations/001_init.sql',import.meta.url),'utf8');
  await sql.unsafe(migration);

  const exists=await sql<{exists:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='datasphere_runtime') AS exists`;
  if(exists[0]?.exists){
    await execFormatted(
      'ALTER ROLE datasphere_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN PASSWORD %L',
      runtimePassword
    );
  }else{
    await execFormatted(
      'CREATE ROLE datasphere_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN PASSWORD %L',
      runtimePassword
    );
  }

  const db=await sql<{name:string}[]>`SELECT current_database() AS name`;
  await execFormatted('GRANT CONNECT ON DATABASE %I TO datasphere_runtime',db[0]!.name);
  await sql.unsafe('REVOKE ALL ON SCHEMA public FROM datasphere_runtime');
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO datasphere_runtime');
  await sql.unsafe('GRANT SELECT, INSERT ON TABLE public.datasphere_events TO datasphere_runtime');
  await sql.unsafe('REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.datasphere_events FROM datasphere_runtime');
  await sql.unsafe("ALTER ROLE datasphere_runtime SET statement_timeout='15s'");
  await sql.unsafe("ALTER ROLE datasphere_runtime SET idle_in_transaction_session_timeout='15s'");

  const role=await sql<{rolsuper:boolean,rolinherit:boolean,rolcreatedb:boolean,rolcreaterole:boolean,rolbypassrls:boolean}[]>`
    SELECT rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolbypassrls
    FROM pg_roles WHERE rolname='datasphere_runtime'`;
  const owner=await sql<{runtime_is_owner:boolean}[]>`
    SELECT (tableowner='datasphere_runtime') AS runtime_is_owner
    FROM pg_tables WHERE schemaname='public' AND tablename='datasphere_events'`;
  const privileges=await sql<{sel:boolean,ins:boolean,upd:boolean,del:boolean,trunc:boolean,ref:boolean,trig:boolean}[]>`
    SELECT
      has_table_privilege('datasphere_runtime','public.datasphere_events','SELECT') AS sel,
      has_table_privilege('datasphere_runtime','public.datasphere_events','INSERT') AS ins,
      has_table_privilege('datasphere_runtime','public.datasphere_events','UPDATE') AS upd,
      has_table_privilege('datasphere_runtime','public.datasphere_events','DELETE') AS del,
      has_table_privilege('datasphere_runtime','public.datasphere_events','TRUNCATE') AS trunc,
      has_table_privilege('datasphere_runtime','public.datasphere_events','REFERENCES') AS ref,
      has_table_privilege('datasphere_runtime','public.datasphere_events','TRIGGER') AS trig`;

  const r=role[0],p=privileges[0];
  if(!r||!p||owner[0]?.runtime_is_owner||r.rolsuper||r.rolinherit||r.rolcreatedb||r.rolcreaterole||r.rolbypassrls||
     !p.sel||!p.ins||p.upd||p.del||p.trunc||p.ref||p.trig){
    throw new Error('DATASPHERE_RUNTIME_ROLE_VERIFICATION_FAILED');
  }

  console.log('DATASPHERE_MIGRATION_OK');
  console.log('DATASPHERE_RUNTIME_ROLE_OK');
}finally{
  await sql.end({timeout:5});
}
