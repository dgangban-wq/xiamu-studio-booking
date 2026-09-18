import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, '..');
const sourceDir = resolve(projectDir, '..', 'offline-app');
const webDir = resolve(projectDir, 'www');

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
await cp(sourceDir, webDir, { recursive: true });

await build({
  entryPoints: [resolve(projectDir, 'src', 'native-bridge.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  outfile: resolve(webDir, 'native-bridge.js')
});

for (const filename of ['index.html', '夏暮工作室预约App-双击打开.html']) {
  const path = resolve(webDir, filename);
  const html = await readFile(path, 'utf8');
  const withBridge = html.replace(
    /\s*<script src="\.\/app\.js\?v=\d+"><\/script>/,
    '\n    <script src="./native-bridge.js"></script>\n    <script src="./app.js"></script>'
  );
  await writeFile(path, withBridge, 'utf8');
}

console.log(`Synced offline web assets to ${webDir}`);
