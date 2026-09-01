const { Pool } = require('pg');
(async () => {
  const pool = new Pool({
    host: '34.170.31.182',
    port: 5432,
    user: 'sprapp',
    password: process.env.DB_PW,
    database: 'sprdb',
    ssl: false,
    connectionTimeoutMillis: 10000,
  });
  try {
    const res = await pool.query('select now() as now');
    console.log('SUCCESS', res.rows[0]);
  } catch (err) {
    console.error('CONNECT_ERROR', err.message || err);
    process.exit(2);
  } finally {
    await pool.end();
  }
})();
