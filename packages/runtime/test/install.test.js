import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverPlugins, installPlugin, uninstallPlugin } from '../src/index.js';

const ENTRY = "export async function run() {}\n";

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal stored (uncompressed) ZIP writer. yazl refuses `../` names, and the
// zip-slip test needs to produce exactly the archive an attacker would.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(entry.externalAttributes ?? 0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function manifest(overrides = {}) {
  return JSON.stringify({
    manifestVersion: 1,
    id: 'zip-plugin',
    name: 'Zip Plugin',
    version: '1.0.0',
    author: { name: 'Tester' },
    description: '测试用插件',
    entry: 'index.js',
    params: [{ key: 'image', type: 'file', required: true }],
    ...overrides,
  });
}

function writeZip(dir, entries, name = 'plugin.zip') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, makeZip(entries));
  return file;
}

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function validEntries(overrides = {}) {
  return [
    { name: 'plugin.json', data: manifest(overrides) },
    { name: 'index.js', data: ENTRY },
    { name: 'lib/util.js', data: 'export const x = 1;\n' },
    // Starts with ".." but stays inside the package; must not be mistaken for
    // a traversal and rejected.
    { name: '..data/values.js', data: 'export const y = 2;\n' },
  ];
}

async function install(root, entries, name) {
  return installPlugin({
    zipPath: writeZip(root, entries, name),
    pluginsDir: path.join(root, 'plugins'),
  });
}

test('installs a valid package, registers it, and discovers it', async (t) => {
  const root = tempRoot(t);
  const pluginsDir = path.join(root, 'plugins');
  const result = await install(root, validEntries());

  assert.equal(result.status, 'installed');
  assert.equal(result.id, 'zip-plugin');
  assert.equal(result.version, '1.0.0');
  assert.ok(fs.existsSync(path.join(pluginsDir, 'zip-plugin', 'index.js')));
  assert.ok(fs.existsSync(path.join(pluginsDir, 'zip-plugin', 'lib', 'util.js')));
  assert.ok(fs.existsSync(path.join(pluginsDir, 'zip-plugin', '..data', 'values.js')));

  const registry = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'registry.json'), 'utf8'));
  assert.equal(registry.plugins['zip-plugin'].version, '1.0.0');
  assert.equal(registry.plugins['zip-plugin'].source, 'plugin.zip');
  assert.match(registry.plugins['zip-plugin'].installedAt, /^\d{4}-\d{2}-\d{2}T/);

  const { plugins, errors } = discoverPlugins(pluginsDir);
  assert.deepEqual(errors, []);
  assert.deepEqual(plugins.map((plugin) => plugin.id), ['zip-plugin']);
});

test('rejects a ZIP without plugin.json', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, [{ name: 'index.js', data: ENTRY }]);
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'missing-manifest');
});

test('rejects a manifest whose entry does not exist', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, validEntries({ entry: 'main.js' }));
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'missing-entry');
});

test('rejects invalid manifest fields', async (t) => {
  const root = tempRoot(t);
  const missingName = JSON.parse(manifest());
  delete missingName.name;
  const result = await install(root, [
    { name: 'plugin.json', data: JSON.stringify(missingName) },
    { name: 'index.js', data: ENTRY },
  ]);
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'invalid-manifest');
  assert.match(result.message, /name/);
});

test('rejects duplicate param keys', async (t) => {
  const root = tempRoot(t);
  const result = await install(
    root,
    validEntries({
      params: [
        { key: 'a', type: 'file' },
        { key: 'a', type: 'string' },
      ],
    }),
  );
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'invalid-manifest');
  assert.match(result.message, /key 重复/);
});

test('rejects unknown param types', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, validEntries({ params: [{ key: 'a', type: 'color' }] }));
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'invalid-manifest');
  assert.match(result.message, /类型非法/);
});

test('rejects an id that could escape the plugins directory', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, validEntries({ id: '../evil' }));
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'invalid-manifest');
  assert.ok(!fs.existsSync(path.join(root, 'evil')));
});

test('rejects an entry that escapes the plugin directory', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, validEntries({ entry: '../index.js' }));
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'invalid-manifest');
});

test('rejects a duplicate id without overwriting the installed copy', async (t) => {
  const root = tempRoot(t);
  const first = await install(root, [
    { name: 'plugin.json', data: manifest() },
    { name: 'index.js', data: 'FIRST' },
  ]);
  assert.equal(first.status, 'installed');

  const second = await install(
    root,
    [
      { name: 'plugin.json', data: manifest({ version: '2.0.0' }) },
      { name: 'index.js', data: 'SECOND' },
    ],
    'second.zip',
  );
  assert.equal(second.status, 'error');
  assert.equal(second.kind, 'duplicate-id');

  const pluginDir = path.join(root, 'plugins', 'zip-plugin');
  assert.equal(fs.readFileSync(path.join(pluginDir, 'index.js'), 'utf8'), 'FIRST');
  const registry = JSON.parse(
    fs.readFileSync(path.join(root, 'plugins', 'registry.json'), 'utf8'),
  );
  assert.equal(registry.plugins['zip-plugin'].version, '1.0.0');
});

test('handles ids that collide with Object.prototype names', async (t) => {
  const root = tempRoot(t);
  const first = await install(root, validEntries({ id: 'constructor', name: 'Constructor' }));
  assert.equal(first.status, 'installed');

  const { plugins } = discoverPlugins(path.join(root, 'plugins'));
  assert.deepEqual(plugins.map((plugin) => plugin.id), ['constructor']);

  const second = await install(
    root,
    validEntries({ id: 'constructor', name: 'Constructor' }),
    'again.zip',
  );
  assert.equal(second.status, 'error');
  assert.equal(second.kind, 'duplicate-id');

  const registry = JSON.parse(
    fs.readFileSync(path.join(root, 'plugins', 'registry.json'), 'utf8'),
  );
  assert.ok(Object.hasOwn(registry.plugins, 'constructor'));
});

test('rejects zip-slip entries and writes nothing outside', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, [
    ...validEntries(),
    { name: '../evil.txt', data: 'evil' },
  ]);
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'unsafe-path');
  assert.ok(!fs.existsSync(path.join(root, 'plugins', 'evil.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'evil.txt')));
});

test('rejects absolute paths in the ZIP', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, [...validEntries(), { name: '/evil.txt', data: 'evil' }]);
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'unsafe-path');
});

test('rejects symlink entries', async (t) => {
  const root = tempRoot(t);
  const result = await install(root, [
    ...validEntries(),
    { name: 'link', data: 'target', externalAttributes: (0o120777 << 16) >>> 0 },
  ]);
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'unsafe-path');
});

test('a rejected install leaves no staging directory', async (t) => {
  const root = tempRoot(t);
  await install(root, [{ name: 'index.js', data: ENTRY }]);
  const pluginsDir = path.join(root, 'plugins');
  const leftovers = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir).filter((name) => name.startsWith('.staging-'))
    : [];
  assert.deepEqual(leftovers, []);
});

test('installs two different ids into one registry', async (t) => {
  const root = tempRoot(t);
  assert.equal((await install(root, validEntries())).status, 'installed');
  assert.equal(
    (
      await install(
        root,
        [
          { name: 'plugin.json', data: manifest({ id: 'second-plugin', name: 'Second' }) },
          { name: 'index.js', data: ENTRY },
        ],
        'second.zip',
      )
    ).status,
    'installed',
  );

  const registry = JSON.parse(
    fs.readFileSync(path.join(root, 'plugins', 'registry.json'), 'utf8'),
  );
  assert.deepEqual(Object.keys(registry.plugins).sort(), ['second-plugin', 'zip-plugin']);
});

test('uninstall removes the plugin directory and its registry entry', async (t) => {
  const root = tempRoot(t);
  const pluginsDir = path.join(root, 'plugins');
  assert.equal((await install(root, validEntries())).status, 'installed');

  const result = await uninstallPlugin({ pluginsDir, id: 'zip-plugin' });
  assert.equal(result.status, 'removed');
  assert.ok(!fs.existsSync(path.join(pluginsDir, 'zip-plugin')));

  const registry = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'registry.json'), 'utf8'));
  assert.equal(registry.plugins['zip-plugin'], undefined);
  assert.deepEqual(discoverPlugins(pluginsDir).plugins, []);
});

test('uninstall refuses a directory that is not a plugin', async (t) => {
  const root = tempRoot(t);
  const pluginsDir = path.join(root, 'plugins');
  const stray = path.join(pluginsDir, 'stray');
  fs.mkdirSync(stray, { recursive: true });

  const result = await uninstallPlugin({ pluginsDir, id: 'stray' });
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'not-found');
  assert.ok(fs.existsSync(stray));
});

test('uninstalling an unknown plugin reports not-found', async (t) => {
  const root = tempRoot(t);
  const result = await uninstallPlugin({
    pluginsDir: path.join(root, 'plugins'),
    id: 'missing',
  });
  assert.equal(result.status, 'error');
  assert.equal(result.kind, 'not-found');
});
