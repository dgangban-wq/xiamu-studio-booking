import { createRequire } from 'node:module';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const sharp = createRequire(import.meta.url)(process.env.PUBLIC_SHARP_MODULE || 'sharp');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Original geometric camera artwork, unrelated to any private studio branding.
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="104" fill="#126b62"/>
<path d="M112 173h68l25-38h102l25 38h68v192H112z" fill="#f2f7f5"/>
<circle cx="256" cy="267" r="73" fill="#103d39"/>
<circle cx="256" cy="267" r="50" fill="#5ab3a5"/>
<circle cx="270" cy="253" r="20" fill="#f2f7f5"/>
<rect x="347" y="196" width="27" height="18" rx="4" fill="#d9ac4b"/>
</svg>`);
await mkdir(resolve(root, 'assets'), { recursive: true });
await sharp(svg).resize(1024, 1024).png().toFile(resolve(root, 'assets/icon.png'));
await copyFile(resolve(root, 'assets/icon.png'), resolve(root, '../public-app/icon.png'));
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const dir = resolve(root, `android/app/src/main/res/mipmap-${density}`);
  await mkdir(dir, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await sharp(svg).resize(size, size).png().toFile(resolve(dir, `${name}.png`));
  }
}
