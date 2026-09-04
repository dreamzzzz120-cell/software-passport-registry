#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// `npm audit` conflates two completely different outcomes in exit code 1: the
// dependency tree really does contain a vulnerability at or above the requested
// level, and npm could not reach its audit endpoint at all. On 2026-09-04 the
// registry answered POST /-/npm/v1/security/audits/quick with 503 and 400 for
// the better part of an hour and failed the Security Gate, the Security
// Hardening Gate and Dependency Remediation on three consecutive commits --
// while one of those same runs logged "found 0 vulnerabilities" in between.
// A red security gate that means "npm was briefly unreachable" trains everyone
// to re-run the gate without reading it, which is how a real finding gets waved
// through.
//
// This wrapper separates the two. A parsed audit report is judged on its own
// counts and a real finding fails immediately, with no retry and no way to
// out-wait it. Only a transport failure is retried, with backoff. If every
// attempt fails to reach the endpoint the run still FAILS: an audit that never
// ran is not an audit that passed, and this script deliberately has no mode in
// which it reports success without a report to show for it.

import { spawn } from 'node:child_process';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

const passthrough = process.argv.slice(2);

// Every argument is forwarded to npm, and on Windows that forwarding has to go
// through a shell (Node refuses to spawn npm.cmd without one). Rather than rely
// on the caller being a workflow file, only plain npm long-options are accepted,
// so there is no argument shape that could carry a shell metacharacter through.
const SAFE_ARGUMENT = /^--[a-z][a-z-]*(=[A-Za-z0-9._,-]+)?$/;
const unsafe = passthrough.filter((arg) => !SAFE_ARGUMENT.test(arg));
if (unsafe.length > 0) {
  console.error(`audit-with-retry: refusing to forward unexpected argument(s) to npm: ${unsafe.join(' ')}`);
  process.exit(1);
}
const levelArg = passthrough.find((arg) => arg.startsWith('--audit-level='));
const level = levelArg ? levelArg.slice('--audit-level='.length) : 'high';
if (!SEVERITIES.includes(level)) {
  console.error(`audit-with-retry: unknown --audit-level=${level}; expected one of ${SEVERITIES.join(', ')}`);
  process.exit(1);
}

const attempts = Number(process.env.AUDIT_RETRY_ATTEMPTS ?? 5);
const baseDelayMs = Number(process.env.AUDIT_RETRY_BASE_DELAY_MS ?? 5000);

// Transport symptoms, not vulnerability findings. Kept deliberately narrow: any
// output that does not match one of these and does not parse as a report is
// treated as a failure rather than as something to retry past.
const TRANSPORT_PATTERNS = [
  /audit endpoint returned an error/i,
  /\baudit\b.*\b(4\d\d|5\d\d)\b.*(bad request|unavailable|timeout|gateway|too many requests)/i,
  /(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ERR_SOCKET_TIMEOUT|network timeout)/i,
  /registry\.npmjs\.org.*(503|502|504|429|400)/i,
];

// CI runs Linux, where npm is spawned directly with no shell. Windows needs the
// shell because Node refuses to spawn npm.cmd without one; the argument
// allowlist above is what makes that safe, since nothing reaching this point
// can contain a shell metacharacter.
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const run = (args) => new Promise((resolve) => {
  let child;
  try {
    child = spawn(npmCommand, args, { shell: isWindows });
  } catch (error) {
    resolve({ code: -1, stdout: '', stderr: `spawn ${npmCommand} failed: ${error.message}` });
    return;
  }
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseReport(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  if (parsed && parsed.error) return { endpointError: parsed.error };
  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') return null;
  return { counts };
}

function atOrAboveLevel(counts) {
  const floor = SEVERITIES.indexOf(level);
  return SEVERITIES
    .slice(floor)
    .reduce((total, severity) => total + (Number(counts[severity]) || 0), 0);
}

function looksTransient(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  return TRANSPORT_PATTERNS.some((pattern) => pattern.test(combined));
}

const auditArgs = ['audit', '--json', ...passthrough];

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = await run(auditArgs);
  const report = parseReport(result.stdout);

  if (report?.counts) {
    const failing = atOrAboveLevel(report.counts);
    const summary = SEVERITIES.map((severity) => `${severity}=${report.counts[severity] ?? 0}`).join(' ');
    if (failing > 0) {
      console.error(`Dependency audit FAILED: ${failing} advisory/advisories at or above "${level}".`);
      console.error(`  counts: ${summary}`);
      console.error('  Run `npm audit` locally for the advisory detail. This is a real finding, not a registry error.');
      process.exit(1);
    }
    console.log(`Dependency audit passed at level "${level}" on attempt ${attempt}.`);
    console.log(`  counts: ${summary}`);
    process.exit(0);
  }

  const transient = report?.endpointError || looksTransient(result);
  const stderrTail = result.stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
  const reason = report?.endpointError
    ? ([report.endpointError.code, report.endpointError.summary, report.endpointError.detail]
        .filter(Boolean).join(' ').trim() || stderrTail || 'audit endpoint returned an error')
    : (stderrTail || `npm exited ${result.code}`);

  if (!transient) {
    console.error('Dependency audit FAILED: npm audit produced no readable report and the failure does not look like a registry outage.');
    console.error(`  npm exit code: ${result.code}`);
    console.error(result.stderr.trim() || result.stdout.trim());
    process.exit(1);
  }

  if (attempt === attempts) break;

  // Exponential backoff with jitter, so parallel gates do not retry in lockstep
  // and hammer an endpoint that is already failing.
  const delay = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
  console.warn(`Dependency audit attempt ${attempt}/${attempts} could not reach the npm audit endpoint (${reason}). Retrying in ${Math.round(delay / 1000)}s.`);
  await sleep(delay);
}

console.error(`Dependency audit FAILED: the npm audit endpoint was unreachable across all ${attempts} attempts.`);
console.error('  No audit report was produced, so this run proves nothing about the dependency tree and is not treated as a pass.');
process.exit(1);
