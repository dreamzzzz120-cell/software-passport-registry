import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];

async function readText(file) {
  try {
    return await readFile(path.join(root, file), "utf8");
  } catch {
    failures.push(`missing required file: ${file}`);
    return "";
  }
}

const license = await readText("LICENSE");
const canonical = await readText("LICENSES/LicenseRef-SPR-Proprietary.txt");
const manifestText = await readText("license-manifest.json");
const packageText = await readText("package.json");

if (!license.includes("SPDX-License-Identifier: LicenseRef-SPR-Proprietary")) {
  failures.push("LICENSE is missing the SPR proprietary SPDX identifier");
}
if (!canonical.includes("SPDX-License-Identifier: LicenseRef-SPR-Proprietary")) {
  failures.push("canonical proprietary license file is missing its SPDX identifier");
}
if (license !== canonical) {
  failures.push("LICENSE and LICENSES/LicenseRef-SPR-Proprietary.txt must remain identical");
}

try {
  const manifest = JSON.parse(manifestText);
  if (manifest?.project?.license !== "LicenseRef-SPR-Proprietary") {
    failures.push("license-manifest.json project.license is incorrect");
  }
  if (manifest?.project?.licenseFile !== "LICENSE") {
    failures.push("license-manifest.json project.licenseFile must remain LICENSE for compatibility");
  }
} catch {
  failures.push("license-manifest.json is not valid JSON");
}

try {
  const pkg = JSON.parse(packageText);
  if (pkg?.license !== "LicenseRef-SPR-Proprietary") {
    failures.push("package.json license is incorrect");
  }
} catch {
  failures.push("package.json is not valid JSON");
}

try {
  const workflowDir = path.join(root, ".github", "workflows");
  const entries = (await readdir(workflowDir)).filter((name) => /\\.(yml|yaml)$/i.test(name));
  for (const name of entries) {
    const content = await readText(path.join(".github", "workflows", name));
    if (!content.includes("SPDX-License-Identifier: LicenseRef-SPR-Proprietary")) {
      failures.push(`workflow missing SPR proprietary SPDX identifier: .github/workflows/${name}`);
    }
  }
} catch {
  failures.push("missing .github/workflows directory");
}

if (failures.length) {
  console.error("License manifest verification FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("License manifest verification PASSED.");
