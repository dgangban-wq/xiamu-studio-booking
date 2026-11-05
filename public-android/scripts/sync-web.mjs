import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const runtimeFiles = Object.freeze([
  'index.html', 'app.js', 'config.js', 'config-ui.js', 'styles.css', 'contact.js', 'author-contact.png', 'operations.js', 'operations.css', 'confirmation.js',
  'lucide.min.js', 'icon.png', 'one-page-guide.svg', '使用说明.html', '一图流.html',
  'manifest.webmanifest', 'sw.js'
]);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function syncWeb(source = resolve(project, '../public-app'), dest = resolve(project, 'www')) {
  // Validate every input before writing. Never recursively copy user data or links.
  for (const name of runtimeFiles) {
    const stat = await lstat(resolve(source, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe runtime asset: ${name}`);
  }
  await mkdir(dest, { recursive: true });
  const allowed = new Set([...runtimeFiles, 'native-bridge.js']);
  for (const name of await readdir(dest)) {
    if (!allowed.has(name)) throw new Error(`Unexpected existing output (not deleted): ${name}`);
    const stat = await lstat(resolve(dest, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe output: ${name}`);
  }
  const html = await readFile(resolve(source, 'index.html'), 'utf8');
  const script = /<script\b[^>]*\bsrc=["'](?:\.\/)?app\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/;
  if (!script.test(html)) throw new Error('Missing app.js entry point');
  for (const name of runtimeFiles) await copyFile(resolve(source, name), resolve(dest, name));
  await build({ entryPoints: [resolve(project, 'src/native-bridge.js')], bundle: true,
    minify: true, format: 'iife', platform: 'browser', outfile: resolve(dest, 'native-bridge.js') });
  await writeFile(resolve(dest, 'index.html'), html.replace(script,
    match => `<script src="./native-bridge.js"></script>\n${match}`));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncWeb();
  console.log('Public runtime allowlist synchronized.');
}
