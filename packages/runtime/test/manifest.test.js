import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, ManifestError } from '../src/index.js';

const valid = {
  manifestVersion: 1,
  id: 'hello-tint',
  name: 'Hello Tint',
  version: '0.1.0',
  author: { name: 'PixelForge', contact: 'dev@pixelforge.local' },
  description: '把输入整体染成一种颜色。',
  entry: 'index.js',
  params: [{ key: 'strength', type: 'range', default: 0.5 }],
};

test('parses a valid manifest, preserving known fields', () => {
  const m = parseManifest(valid);
  assert.equal(m.id, 'hello-tint');
  assert.equal(m.name, 'Hello Tint');
  assert.equal(m.version, '0.1.0');
  assert.equal(m.entry, 'index.js');
  assert.equal(m.manifestVersion, 1);
  assert.deepEqual(m.author, { name: 'PixelForge', contact: 'dev@pixelforge.local' });
  assert.equal(m.description, '把输入整体染成一种颜色。');
  assert.equal(m.params.length, 1);
});

test('defaults optional fields when omitted', () => {
  const m = parseManifest({ id: 'x', name: 'X', version: '1.0.0', entry: 'index.js' });
  assert.equal(m.manifestVersion, 1);
  assert.deepEqual(m.author, { name: '', contact: '' });
  assert.equal(m.description, '');
  assert.deepEqual(m.params, []);
});

test('rejects a non-object manifest', () => {
  assert.throws(() => parseManifest(null), ManifestError);
  assert.throws(() => parseManifest('nope'), ManifestError);
  assert.throws(() => parseManifest([]), ManifestError);
});

for (const field of ['id', 'name', 'version', 'entry']) {
  test(`rejects a manifest missing required field "${field}"`, () => {
    const raw = { ...valid };
    delete raw[field];
    assert.throws(() => parseManifest(raw), (err) => {
      assert.ok(err instanceof ManifestError);
      assert.match(err.message, new RegExp(field));
      return true;
    });
  });
}

test('rejects a non-array params field', () => {
  assert.throws(() => parseManifest({ ...valid, params: {} }), ManifestError);
});
