#!/usr/bin/env node
/* SPDX-License-Identifier: LicenseRef-SPR-Proprietary */
/* Copyright (c) 2026 Software Passport Registry. All rights reserved. */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const workflowDir = join(process.cwd(), '.github', 'workflows');
const shaPattern = /^[0-9a-f]{40}$/i;
const usesPattern = /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/;

const files = (await readdir(workflowDir)).filter((name) => /\.(yml|yaml)$/i.test(name)).sort();
const violations = [];

for (const file of files) {
  const lines = (await readFile(join(workflowDir, file), 'utf8')).split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(usesPattern);
    if (!match) return;

    const ref = match[1];
    // Local actions are resolved from this repository and do not have an external ref.
    if (ref.startsWith('./') || ref.startsWith('../')) return;

    const at = ref.lastIndexOf('@');
    if (at <= 0 || !shaPattern.test(ref.slice(at + 1))) {
      violations.push(`${file}:${index + 1}: ${ref}`);
    }
  });
}

if (violations.length) {
  console.error('Unpinned GitHub Actions detected. External actions must use a full 40-character commit SHA.');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`GitHub Action pinning verified: ${files.length} workflow files checked.`);
