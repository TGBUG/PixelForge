// Guards the primary seam: the runtime library must stay pure Node.
// See CONTEXT.md > 架构概览 and ADR-0001.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(RUNTIME_ROOT, 'src');

const ELECTRON_IMPORT = /(?:require\s*\(\s*|from\s*|import\s*\(\s*)['"]electron/;

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('runtime source contains a non-empty module tree', () => {
  assert.ok(jsFiles(SRC).length > 0);
});

test('no runtime source file imports electron', () => {
  for (const file of jsFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!ELECTRON_IMPORT.test(text), `${file} must not import electron`);
  }
});

test('runtime package declares no runtime dependency on electron', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
  assert.ok(!('electron' in deps), 'runtime must not depend on electron');
});

test('runtime imports cleanly under plain node', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod.parseManifest, 'function');
  assert.equal(typeof mod.discoverPlugins, 'function');
});
