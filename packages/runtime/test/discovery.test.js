import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'plugins');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pf-disc-'));
}

test('discovers the fixture plugins with display metadata', () => {
  const { plugins, errors } = discoverPlugins(FIXTURES);
  assert.equal(errors.length, 0);
  const ids = plugins.map((p) => p.id);
  assert.ok(ids.includes('hello-tint'), `expected hello-tint among ${ids}`);

  const tint = plugins.find((p) => p.id === 'hello-tint');
  assert.equal(tint.manifest.id, 'hello-tint');
  assert.ok(tint.manifest.name.length > 0);
  assert.ok(tint.manifest.author.name.length > 0);
  assert.ok(tint.manifest.version.length > 0);
  assert.ok(tint.manifest.description.length > 0);
  assert.equal(tint.dir, path.join(FIXTURES, 'hello-tint'));
});

test('returns an empty list for a nonexistent directory', () => {
  const { plugins, errors } = discoverPlugins(path.join(tmpDir(), 'does-not-exist'));
  assert.deepEqual(plugins, []);
  assert.deepEqual(errors, []);
});

test('ignores files and directories without plugin.json', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'loose.txt'), 'hi');
  fs.mkdirSync(path.join(root, 'not-a-plugin'));
  fs.writeFileSync(path.join(root, 'not-a-plugin', 'readme.md'), 'hi');
  const { plugins, errors } = discoverPlugins(root);
  assert.deepEqual(plugins, []);
  assert.deepEqual(errors, []);
});

test('reports malformed plugin.json as an error without aborting discovery', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'broken'));
  fs.writeFileSync(path.join(root, 'broken', 'plugin.json'), '{ not json');
  fs.mkdirSync(path.join(root, 'good'));
  fs.writeFileSync(
    path.join(root, 'good', 'plugin.json'),
    JSON.stringify({ id: 'good', name: 'Good', version: '1.0.0', entry: 'index.js' }),
  );

  const { plugins, errors } = discoverPlugins(root);
  assert.deepEqual(plugins.map((p) => p.id), ['good']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].dir, path.join(root, 'broken'));
});

test('returns plugins sorted by id', () => {
  const root = tmpDir();
  for (const id of ['zebra', 'alpha', 'mango']) {
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(
      path.join(root, id, 'plugin.json'),
      JSON.stringify({ id, name: id, version: '1.0.0', entry: 'index.js' }),
    );
  }
  const { plugins } = discoverPlugins(root);
  assert.deepEqual(plugins.map((p) => p.id), ['alpha', 'mango', 'zebra']);
});
