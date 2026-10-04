const { Pool } = require('pg');

const q = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.SUPABASE_MIGRATION_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error(JSON.stringify({ event: 'migration_failed', error: 'MISSING_DATABASE_URL' }));
  process.exit(1);
}

const source = new Pool({
  connectionString: sourceUrl,
  ssl: process.env.SQL_SSL_CA
    ? { rejectUnauthorized: true, ca: process.env.SQL_SSL_CA }
    : { rejectUnauthorized: false },
  max: 2,
});

const target = new Pool({
  connectionString: targetUrl,
  ssl: { rejectUnauthorized: true },
  max: 2,
});

async function main() {
  const sourceTables = (await source.query(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
  )).rows.map((row) => row.table_name);

  const targetTables = new Set((await target.query(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
  )).rows.map((row) => row.table_name));

  const tables = sourceTables.filter(
    (table) => targetTables.has(table) && table !== 'spr_migration_fk_backup'
  );

  if (!tables.length) throw new Error('NO_SHARED_TABLES');

  await target.query('BEGIN');
  try {
    await target.query(
      'TRUNCATE TABLE ' +
        tables.map((table) => 'public.' + q(table)).join(', ') +
        ''
    );

    let totalRows = 0;

    for (const table of tables) {
      const sourceColumns = (await source.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position",
        [table]
      )).rows.map((row) => row.column_name);

      const targetColumnRows = (await target.query(
        "select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position",
        [table]
      )).rows;
      const targetColumnSet = new Set(targetColumnRows.map((row) => row.column_name));
      const targetTypes = new Map(targetColumnRows.map((row) => [row.column_name, row.udt_name]));

      const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
      if (!columns.length) continue;

      const sourceCount = Number((await source.query(
        'select count(*)::bigint as count from public.' + q(table)
      )).rows[0].count);

      const batchSize = 100;
      for (let offset = 0; offset < sourceCount; offset += batchSize) {
        const rows = (await source.query(
          'select ' + columns.map(q).join(', ') +
          ' from public.' + q(table) +
          ' limit $1 offset $2',
          [batchSize, offset]
        )).rows;

        if (!rows.length) break;

        const values = [];
        const groups = rows.map((row, rowIndex) => {
          const placeholders = columns.map((column, columnIndex) => {
            let value = row[column];
            const targetType = targetTypes.get(column);
            if ((targetType === 'json' || targetType === 'jsonb') && typeof value === 'string') {
              try {
                value = JSON.parse(value);
              } catch {
                value = JSON.stringify(value);
              }
            }
            values.push(value);
            return '
          });
          return '(' + placeholders.join(',') + ')';
        });

        await target.query(
          'insert into public.' + q(table) +
          ' (' + columns.map(q).join(', ') + ') values ' + groups.join(','),
          values
        );
      }

      const targetCount = Number((await target.query(
        'select count(*)::bigint as count from public.' + q(table)
      )).rows[0].count);

      if (targetCount !== sourceCount) {
        throw new Error(
          'COUNT_MISMATCH ' + table + ' source=' + sourceCount + ' target=' + targetCount
        );
      }

      totalRows += sourceCount;
      console.log(JSON.stringify({ event: 'migration_table', table, rows: sourceCount }));
    }

    const serialColumns = (await target.query(
      "select table_name,column_name from information_schema.columns where table_schema='public' and column_default like 'nextval(%'"
    )).rows;

    for (const { table_name: table, column_name: column } of serialColumns) {
      if (!tables.includes(table)) continue;
      const seq = (await target.query(
        'select pg_get_serial_sequence($1,$2) as seq',
        ['public.' + table, column]
      )).rows[0]?.seq;
      if (!seq) continue;
      const row = (await target.query(
        'select max(' + q(column) + ')::bigint as max_value from public.' + q(table)
      )).rows[0];
      if (row.max_value !== null) {
        await target.query('select setval($1::regclass,$2,true)', [seq, row.max_value]);
      }
    }

    await target.query('COMMIT');
    console.log(JSON.stringify({ event: 'migration_complete', tables: tables.length, rows: totalRows }));
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'migration_failed', error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
 + (rowIndex * columns.length + columnIndex + 1);
          });
          return '(' + placeholders.join(',') + ')';
        });

        await target.query(
          'insert into public.' + q(table) +
          ' (' + columns.map(q).join(', ') + ') values ' + groups.join(','),
          values
        );
      }

      const targetCount = Number((await target.query(
        'select count(*)::bigint as count from public.' + q(table)
      )).rows[0].count);

      if (targetCount !== sourceCount) {
        throw new Error(
          'COUNT_MISMATCH ' + table + ' source=' + sourceCount + ' target=' + targetCount
        );
      }

      totalRows += sourceCount;
      console.log(JSON.stringify({ event: 'migration_table', table, rows: sourceCount }));
    }

    const serialColumns = (await target.query(
      "select table_name,column_name from information_schema.columns where table_schema='public' and column_default like 'nextval(%'"
    )).rows;

    for (const { table_name: table, column_name: column } of serialColumns) {
      if (!tables.includes(table)) continue;
      const seq = (await target.query(
        'select pg_get_serial_sequence($1,$2) as seq',
        ['public.' + table, column]
      )).rows[0]?.seq;
      if (!seq) continue;
      const row = (await target.query(
        'select max(' + q(column) + ')::bigint as max_value from public.' + q(table)
      )).rows[0];
      if (row.max_value !== null) {
        await target.query('select setval($1::regclass,$2,true)', [seq, row.max_value]);
      }
    }

    await target.query('COMMIT');
    console.log(JSON.stringify({ event: 'migration_complete', tables: tables.length, rows: totalRows }));
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'migration_failed', error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
