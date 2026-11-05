const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);

test('README navigation targets exist locally', () => {
  for (const link of links.filter(link => link.startsWith('./'))) {
    assert.ok(fs.existsSync(path.resolve(root, decodeURIComponent(link.split('#')[0]))), link);
  }
});

test('README offers direct APK and ZIP downloads with matching fallback files', () => {
  const primary = links.filter(link => link.startsWith('https://github.com/') && link.includes('/raw/'));
  const fallback = links.filter(link => link.startsWith('https://raw.githubusercontent.com/'));
  assert.equal(primary.length, 2);
  assert.equal(fallback.length, 2);
  const targets = urls => urls.map(link => {
    const url = new URL(link);
    const prefix = url.hostname === 'github.com'
      ? '/dgangban-wq/xiamu-studio-booking/raw/refs/heads/main/'
      : '/dgangban-wq/xiamu-studio-booking/main/';
    assert.ok(url.pathname.startsWith(prefix), link);
    const relative = decodeURIComponent(url.pathname.slice(prefix.length));
    assert.ok(relative.startsWith('公开版安装包/'), link);
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.ok(bytes.length > 1000000, 'download must contain a built artifact');
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304', 'APK/ZIP magic');
    return relative;
  });
  assert.deepEqual(targets(primary).sort(), targets(fallback).sort());
  assert.ok(primary.some(link => new URL(link).pathname.endsWith('.apk')));
  assert.ok(primary.some(link => new URL(link).pathname.endsWith('.zip')));
});
