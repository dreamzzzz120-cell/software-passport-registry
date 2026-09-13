import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');

const routes = ['security', 'contact', 'data-retention', 'subprocessors'];
for (const route of routes) {
  const source = path.join(publicDir, route, 'index.html');
  const destination = path.join(distDir, route, 'index.html');
  if (!fs.existsSync(source)) throw new Error(`[restore-public] missing ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`[restore-public] ${route} -> ${path.relative(root, destination)}`);
}
