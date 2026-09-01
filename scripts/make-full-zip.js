import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'SPR-full-app.zip');

const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Created ${outputPath} (${archive.pointer()} bytes)`);
});
archive.on('warning', err => {
  if (err.code === 'ENOENT') console.warn(err);
  else throw err;
});
archive.on('error', err => { throw err; });

archive.pipe(output);

// Exclude large or environment-specific folders
const ignore = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  '.vscode/**',
  '*.zip',
  'SPR-full-app.zip'
];

archive.glob('**/*', { cwd: root, dot: true, ignore });
archive.finalize();
