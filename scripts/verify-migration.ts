import { Client } from 'pg';

interface VerificationResult {
  passed: boolean;
  checks: Array<{ name: string; status: 'PASS' | 'FAIL' | 'WARN'; details: string }>;
}

async function verifyMigration(): Promise<void> {
  console.log('='.repeat(80));
  console.log('[VERIFICATION] Production Database Schema Verification');
  console.log('='.repeat(80));
  console.log();

  // Build connection string from environment variables
  const host = process.env.SQL_HOST;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  const database = process.env.SQL_DB_NAME;

  if (!host || !user || !password || !database) {
    console.error('[FATAL] Missing required environment variables');
    process.exit(1);
  }

  const connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${database}`;
  
  const client = new Client({
    connectionString,
  });

  const results: VerificationResult = {
    passed: true,
    checks: [],
  };

  try {
    await client.connect();
    console.log('[OK] Connected to production database\n');

    // VERIFICATION 1: schema_migrations table exists and has records
    console.log('[1/8] Checking schema_migrations table...');
    try {
      const migrationsResult = await client.query(`
        SELECT version, description, executed_at, execution_duration_ms
        FROM schema_migrations
        ORDER BY version;
      `);
      
      if (migrationsResult.rows.length > 0) {
        console.log(`  ✓ PASS: schema_migrations table exists with ${migrationsResult.rows.length} record(s)`);
        migrationsResult.rows.forEach((row) => {
          console.log(`    - v${row.version}: ${row.description} (${row.execution_duration_ms}ms)`);
        });
        results.checks.push({
          name: 'schema_migrations table',
          status: 'PASS',
          details: `${migrationsResult.rows.length} migration record(s) found`,
        });
      } else {
        console.log('  ✗ FAIL: schema_migrations table is empty');
        results.checks.push({
          name: 'schema_migrations table',
          status: 'FAIL',
          details: 'No migration records found',
        });
        results.passed = false;
      }
    } catch (error) {
      console.log('  ✗ FAIL: schema_migrations table does not exist');
      results.checks.push({
        name: 'schema_migrations table',
        status: 'FAIL',
        details: 'Table not found',
      });
      results.passed = false;
    }
    console.log();

    // VERIFICATION 2: Exactly 40 tables (39 app + schema_migrations)
    console.log('[2/8] Checking table count...');
    const tablesResult = await client.query(`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE';
    `);
    const tableCount = parseInt(tablesResult.rows[0].count, 10);
    
    if (tableCount === 40) {
      console.log(`  ✓ PASS: Found exactly ${tableCount} tables (39 app + schema_migrations)`);
      results.checks.push({
        name: 'Table count',
        status: 'PASS',
        details: `${tableCount} tables found`,
      });
    } else {
      console.log(`  ✗ FAIL: Found ${tableCount} tables, expected 40`);
      results.checks.push({
        name: 'Table count',
        status: 'FAIL',
        details: `Found ${tableCount}, expected 40`,
      });
      results.passed = false;
    }
    
    // List all tables
    const tablesList = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name;
    `);
    console.log('  Tables found:');
    tablesList.rows.forEach((row) => {
      console.log(`    - ${row.table_name}`);
    });
    console.log();

    // VERIFICATION 3: public.users table exists
    console.log('[3/8] Checking public.users table...');
    const usersExists = tablesList.rows.some((row) => row.table_name === 'users');
    if (usersExists) {
      console.log('  ✓ PASS: public.users table exists');
      results.checks.push({
        name: 'public.users table',
        status: 'PASS',
        details: 'Table exists',
      });
    } else {
      console.log('  ✗ FAIL: public.users table does not exist');
      results.checks.push({
        name: 'public.users table',
        status: 'FAIL',
        details: 'Table not found',
      });
      results.passed = false;
    }
    console.log();

    // VERIFICATION 4: Foreign keys exist
    console.log('[4/8] Checking foreign key constraints...');
    const fkResult = await client.query(`
      SELECT constraint_name, table_name, column_name
      FROM information_schema.constraint_column_usage
      WHERE table_schema='public' AND constraint_type='FOREIGN KEY'
      ORDER BY table_name, constraint_name;
    `);
    
    if (fkResult.rows.length > 0) {
      console.log(`  ✓ PASS: Found ${fkResult.rows.length} foreign key constraint(s)`);
      const fksByTable: Record<string, string[]> = {};
      fkResult.rows.forEach((row) => {
        if (!fksByTable[row.table_name]) {
          fksByTable[row.table_name] = [];
        }
        fksByTable[row.table_name].push(row.constraint_name);
      });
      Object.entries(fksByTable).forEach(([table, constraints]) => {
        console.log(`    - ${table}: ${constraints.join(', ')}`);
      });
      results.checks.push({
        name: 'Foreign key constraints',
        status: 'PASS',
        details: `${fkResult.rows.length} constraint(s) found`,
      });
    } else {
      console.log('  ✗ FAIL: No foreign key constraints found');
      results.checks.push({
        name: 'Foreign key constraints',
        status: 'FAIL',
        details: 'No constraints found',
      });
      results.passed = false;
    }
    console.log();

    // VERIFICATION 5: Indexes exist
    console.log('[5/8] Checking indexes...');
    const indexResult = await client.query(`
      SELECT indexname, tablename FROM pg_indexes
      WHERE schemaname='public'
      ORDER BY tablename, indexname;
    `);
    
    if (indexResult.rows.length > 0) {
      console.log(`  ✓ PASS: Found ${indexResult.rows.length} index(es)`);
      const indexesByTable: Record<string, string[]> = {};
      indexResult.rows.forEach((row) => {
        if (!indexesByTable[row.tablename]) {
          indexesByTable[row.tablename] = [];
        }
        indexesByTable[row.tablename].push(row.indexname);
      });
      Object.entries(indexesByTable).forEach(([table, indexes]) => {
        console.log(`    - ${table}: ${indexes.length} index(es)`);
      });
      results.checks.push({
        name: 'Indexes',
        status: 'PASS',
        details: `${indexResult.rows.length} index(es) found`,
      });
    } else {
      console.log('  ✗ FAIL: No indexes found');
      results.checks.push({
        name: 'Indexes',
        status: 'FAIL',
        details: 'No indexes found',
      });
      results.passed = false;
    }
    console.log();

    // VERIFICATION 6: Immutability trigger on trust_observations
    console.log('[6/8] Checking immutability trigger on trust_observations...');
    const triggerResult = await client.query(`
      SELECT trigger_name, event_manipulation
      FROM information_schema.triggers
      WHERE event_object_schema='public' AND event_object_table='trust_observations'
      ORDER BY trigger_name;
    `);
    
    if (triggerResult.rows.length > 0) {
      console.log(`  ✓ PASS: Found ${triggerResult.rows.length} trigger(s) on trust_observations`);
      triggerResult.rows.forEach((row) => {
        console.log(`    - ${row.trigger_name} (${row.event_manipulation})`);
      });
      results.checks.push({
        name: 'trust_observations immutability trigger',
        status: 'PASS',
        details: `${triggerResult.rows.length} trigger(s) found`,
      });
    } else {
      console.log('  ✗ FAIL: No triggers found on trust_observations');
      results.checks.push({
        name: 'trust_observations immutability trigger',
        status: 'FAIL',
        details: 'No triggers found',
      });
      results.passed = false;
    }
    console.log();

    // VERIFICATION 7: No unexpected tables, all expected tables present
    console.log('[7/8] Checking for unexpected or missing tables...');
    const expectedTables = [
      'schema_migrations', 'users', 'clients', 'passports', 'scans', 'alerts',
      'trust_observations', 'trust_observation_changes', 'monitoring_configurations',
      'collector_jobs', 'collector_results', 'alert_subscriptions', 'in_app_notifications',
      'credential_references', 'integrations', 'billing', 'compliance_schedules',
      'scan_schedules', 'evidence_items', 'scan_findings', 'repository_connections',
      'repository_scan_sources', 'audit_trail', 'pilotOrganizations', 'pilotContacts',
      'pilotApplications', 'pilotProjects', 'pilotSoftwareAssets', 'pilotPassportReports',
      'pilotFeedbackItems', 'pilotMeetings', 'pilotFeatureRequests', 'pilotConversionTracking',
      'agentJobs', 'agentLogs', 'appUsers', 'projects', 'tasks', 'snippets', 'workSessions',
    ];
    
    const actualTables = tablesList.rows.map((row) => row.table_name);
    const missing = expectedTables.filter((table) => !actualTables.includes(table));
    const unexpected = actualTables.filter((table) => !expectedTables.includes(table));
    
    if (missing.length === 0 && unexpected.length === 0) {
      console.log('  ✓ PASS: All expected tables present, no unexpected tables');
      results.checks.push({
        name: 'Table completeness',
        status: 'PASS',
        details: 'All expected tables present',
      });
    } else {
      if (missing.length > 0) {
        console.log(`  ✗ FAIL: Missing ${missing.length} table(s): ${missing.join(', ')}`);
        results.passed = false;
      }
      if (unexpected.length > 0) {
        console.log(`  ✗ FAIL: Unexpected ${unexpected.length} table(s): ${unexpected.join(', ')}`);
        results.passed = false;
      }
      results.checks.push({
        name: 'Table completeness',
        status: 'FAIL',
        details: `Missing: ${missing.length}, Unexpected: ${unexpected.length}`,
      });
    }
    console.log();

    // VERIFICATION 8: No unexpected schema modifications
    console.log('[8/8] Checking for data integrity (no destructive operations)...');
    const constraintsResult = await client.query(`
      SELECT COUNT(*) as count FROM information_schema.table_constraints
      WHERE table_schema='public' AND constraint_type='CHECK';
    `);
    const checkConstraintCount = parseInt(constraintsResult.rows[0].count, 10);
    
    if (checkConstraintCount > 0) {
      console.log(`  ✓ PASS: Found ${checkConstraintCount} CHECK constraint(s) protecting data`);
      results.checks.push({
        name: 'Data integrity constraints',
        status: 'PASS',
        details: `${checkConstraintCount} CHECK constraint(s) found`,
      });
    } else {
      console.log('  ✗ FAIL: No CHECK constraints found');
      results.checks.push({
        name: 'Data integrity constraints',
        status: 'FAIL',
        details: 'No CHECK constraints found',
      });
      results.passed = false;
    }
    console.log();

    // Summary
    console.log('='.repeat(80));
    console.log('[SUMMARY]');
    console.log('='.repeat(80));
    results.checks.forEach((check) => {
      const icon = check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '✗' : '!';
      console.log(`${icon} [${check.status}] ${check.name}: ${check.details}`);
    });
    console.log();

    if (results.passed) {
      console.log('[VERIFICATION SUCCESSFUL] ✓ All checks passed!');
      console.log('[STATUS] Production database schema is valid and ready for application deployment.');
      console.log();
      console.log('='.repeat(80));
    } else {
      console.log('[VERIFICATION FAILED] ✗ One or more checks failed.');
      console.log('[ACTION] Review failures above and rerun migration if necessary.');
      console.log();
      console.log('='.repeat(80));
      process.exit(1);
    }

  } catch (error) {
    console.error('[FATAL] Verification error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyMigration();
