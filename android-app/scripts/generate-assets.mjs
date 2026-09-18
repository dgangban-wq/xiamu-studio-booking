import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, '..');
const logoPath = resolve(projectDir, '..', 'offline-app', 'logo.jpg');
const assetDir = resolve(projectDir, 'assets');

await mkdir(assetDir, { recursive: true });

await sharp(logoPath)
  .extract({ left: 145, top: 75, width: 350, height: 350 })
  .resize(1024, 1024)
  .png()
  .toFile(resolve(assetDir, 'icon-only.png'));

const splashLogo = await sharp(logoPath)
  .resize(1280, 1280, { fit: 'contain', background: '#f7fbef' })
  .png()
  .toBuffer();

await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: '#f7fbef' }
})
  .composite([{ input: splashLogo, gravity: 'center' }])
  .png()
  .toFile(resolve(assetDir, 'splash.png'));

console.log(`Generated Android source assets in ${assetDir}`);
