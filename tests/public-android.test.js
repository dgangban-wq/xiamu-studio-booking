const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const project = path.join(root, 'public-android');
const read = name => fs.readFile(path.join(project, name), 'utf8');

test('public application has independent identity, baseline version and no INTERNET', async () => {
  const config = JSON.parse(await read('capacitor.config.json'));
  assert.equal(config.appId, 'com.studiobooking.publicapp');
  assert.equal(config.appName, '摄影棚预约管理');
  const gradle = await read('android/app/build.gradle');
  assert.match(gradle, /applicationId 'com\.studiobooking\.publicapp'/);
  assert.match(gradle, /versionCode 4\b/);
  assert.match(gradle, /versionName '1\.1\.0'/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|com\.xiamustudio/);
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /\$\{applicationId\}\.fileprovider/);
  const paths = await read('android/app/src/main/res/xml/file_paths.xml');
  assert.doesNotMatch(paths, /external-path/);
  assert.match(paths, /path="backups\/"/);
  assert.match(paths, /path="confirmation\/"/);
});

test('npm lockfile agrees with exact pinned dependencies', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(pkg.version, '1.1.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
});

test('release requires external credentials, with no debug fallback', async () => {
  const gradle = await read('android/app/build.gradle');
  for (const env of ['KEYSTORE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
    assert.ok(gradle.includes(`System.getenv('PUBLIC_ANDROID_${env}')`));
  }
  assert.match(gradle, /throw new GradleException/);
  assert.match(gradle, /startsWith\(rootDir.parentFile/);
  const script = await fs.readFile(path.join(root, 'scripts/build-public-android.ps1'), 'utf8');
  assert.match(script, /apksigner.bat.*verify --verbose/);
  assert.match(script, /android.permission.INTERNET/);
});

test('native bridge preserves web API and uses generic backup branding', async () => {
  const bridge = await read('src/native-bridge.js');
  assert.match(bridge, /window.XiamuNative/);
  assert.match(bridge, /xiamu:native-back/);
  assert.match(bridge, /Directory.Cache/);
  assert.match(bridge, /shareImage/);
  assert.match(bridge, /confirmation\/booking\.png/);
  assert.doesNotMatch(bridge, /夏暮|xiamustudio/);
});

test('sync allowlist excludes private files, injects bridge, and fails closed', async t => {
  const { syncWeb, runtimeFiles } = await import(pathToFileURL(path.join(project, 'scripts/sync-web.mjs')));
  assert.deepEqual([...runtimeFiles].sort(), [
    'index.html', 'app.js', 'config.js', 'config-ui.js', 'styles.css', 'lucide.min.js', 'contact.js', 'author-contact.png', 'operations.js', 'operations.css', 'confirmation.js',
    'icon.png', 'one-page-guide.svg', '使用说明.html', '一图流.html', 'manifest.webmanifest', 'sw.js'
  ].sort());
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'public-android-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const dest = path.join(temp, 'output');
  await fs.mkdir(source);
  for (const name of runtimeFiles) await fs.writeFile(path.join(source, name),
    name === 'index.html' ? '<html><script defer src="./app.js?v=123"></script></html>' : 'fixture');
  await fs.writeFile(path.join(source, 'customer-backup.json'), 'private');
  await fs.writeFile(path.join(source, 'private.p12'), 'private');
  await syncWeb(source, dest);
  assert.deepEqual((await fs.readdir(dest)).sort(), [...runtimeFiles, 'native-bridge.js'].sort());
  const html = await fs.readFile(path.join(dest, 'index.html'), 'utf8');
  assert.ok(html.indexOf('native-bridge.js') < html.indexOf('app.js'));
  await fs.writeFile(path.join(dest, 'unexpected.json'), 'must not delete');
  await assert.rejects(syncWeb(source, dest), /Unexpected existing output/);
  assert.equal(await fs.readFile(path.join(dest, 'unexpected.json'), 'utf8'), 'must not delete');
  await fs.unlink(path.join(source, 'config.js'));
  await assert.rejects(syncWeb(source, dest), /ENOENT/);
});
