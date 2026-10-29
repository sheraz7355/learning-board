// Copies Excalidraw's fonts next to the app (public/fonts), so the board works offline and loads nothing
// from a CDN. Runs before `dev` and `build`. Plain Node: works the same on Windows, Mac and Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
const to = path.join(root, 'public', 'fonts');
if (!fs.existsSync(from)) {
  console.error('Excalidraw fonts not found — run `npm install` first.');
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('fonts copied to public/fonts');
