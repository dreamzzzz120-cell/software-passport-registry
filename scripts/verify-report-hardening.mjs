import { readFile } from 'node:fs/promises';

const reportUi = await readFile('src/components/PassportsView.tsx', 'utf8');

const forbidden = [
  { pattern: /simulat(?:e|ed|ing)?\s+(?:report|audit)\s+completion/i, label: 'simulated report completion' },
  { pattern: /setTimeout\s*\(/, label: 'setTimeout-based report completion' },
  { pattern: /setAuditJob\s*\(\s*\{[^}]*status:\s*['\"](?:Completed|Succeeded)['\"]/s, label: 'client-fabricated completed job state' },
  { pattern: /setAuditText\s*\(\s*['\"][^'\"]*(?:verified|complete|completed)[^'\"]*['\"]\s*\)/i, label: 'client-fabricated verification text' },
];

for (const { pattern, label } of forbidden) {
  if (pattern.test(reportUi)) {
    console.error(`REPORT_HARDENING_FAIL: ${label}`);
    process.exit(1);
  }
}

const required = [
  { pattern: /POST\s+['\"]\/api\/agent-jobs['\"]|apiFetch\(['\"]\/api\/agent-jobs['\"]/, label: 'server-backed audit job creation' },
  { pattern: /\/api\/agent-jobs\/\$\{encodeURIComponent\(jobId\)\}/, label: 'server-backed job status polling' },
  { pattern: /\/logs['\"]\)/, label: 'server-backed audit log retrieval' },
];

for (const { pattern, label } of required) {
  if (!pattern.test(reportUi)) {
    console.error(`REPORT_HARDENING_FAIL: missing ${label}`);
    process.exit(1);
  }
}

console.log('REPORT_HARDENING_PASS: audit/report UI is server-authoritative and contains no simulated completion path.');
