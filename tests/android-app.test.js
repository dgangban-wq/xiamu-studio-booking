const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const androidRoot = path.join(root, 'android-app');

test('android wrapper uses the Xiamu identity and bundled web directory', () => {
  const config = JSON.parse(fs.readFileSync(path.join(androidRoot, 'capacitor.config.json'), 'utf8'));
  assert.equal(config.appId, 'com.xiamustudio.booking');
  assert.equal(config.appName, '夏暮工作室摄影棚预约');
  assert.equal(config.webDir, 'www');
  assert.equal(config.android.allowMixedContent, false);
});

test('android manifest is local-only and does not request internet access', () => {
  const manifest = fs.readFileSync(path.join(androidRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test('android web bundle includes native backup support before app startup', () => {
  const html = fs.readFileSync(path.join(androidRoot, 'www', 'index.html'), 'utf8');
  const bridgePosition = html.indexOf('./native-bridge.js');
  const appPosition = html.indexOf('./app.js');
  assert.ok(bridgePosition >= 0);
  assert.ok(appPosition > bridgePosition);

  const bridge = fs.readFileSync(path.join(androidRoot, 'src', 'native-bridge.js'), 'utf8');
  assert.match(bridge, /Filesystem\.writeFile/);
  assert.match(bridge, /Share\.share/);

  const app = fs.readFileSync(path.join(root, 'offline-app', 'app.js'), 'utf8');
  assert.match(app, /window\.XiamuNative\.exportBackup/);
  assert.match(app, /!window\.XiamuNative\?\.isNative && 'serviceWorker' in navigator/);
});

test('android v1.2 handles the native back button without adding network access', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(androidRoot, 'package.json'), 'utf8'));
  const bridge = fs.readFileSync(path.join(androidRoot, 'src', 'native-bridge.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(androidRoot, 'android', 'app', 'build.gradle'), 'utf8');

  assert.ok(packageJson.dependencies['@capacitor/app']);
  assert.match(bridge, /App\.addListener\(['"]backButton['"]/);
  assert.match(bridge, /xiamu:native-back/);
  assert.match(gradle, /versionCode 3/);
  assert.match(gradle, /versionName "1\.2"/);
});
