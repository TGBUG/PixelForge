import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveParams } from '../src/index.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-params-'));
  const file = path.join(dir, 'a.png');
  fs.writeFileSync(file, 'x');
  return file;
}

test('fills defaults for declared params', () => {
  const resolved = resolveParams(
    [
      { key: 'strength', type: 'range', default: 0.5, min: 0, max: 1 },
      { key: 'label', type: 'string', default: 'hi' },
      { key: 'enabled', type: 'boolean', default: false },
      { key: 'mode', type: 'enum', default: 'a', options: [{ value: 'a' }, { value: 'b' }] },
    ],
    {},
  );
  assert.deepEqual(resolved, { strength: 0.5, label: 'hi', enabled: false, mode: 'a' });
});

test('provided values override defaults', () => {
  const resolved = resolveParams(
    [{ key: 'strength', type: 'range', default: 0.5, min: 0, max: 1 }],
    { strength: 0.25 },
  );
  assert.equal(resolved.strength, 0.25);
});

test('rejects a missing required file', () => {
  assert.throws(
    () => resolveParams([{ key: 'image', type: 'file', required: true, label: '底图' }], {}),
    /缺少必填参数：底图/,
  );
});

test('rejects a file that does not exist', () => {
  assert.throws(
    () =>
      resolveParams(
        [{ key: 'image', type: 'file', required: true }],
        { image: path.join(os.tmpdir(), 'pf-does-not-exist.png') },
      ),
    /文件不存在/,
  );
});

test('accepts an existing file and keeps its path', () => {
  const file = tempFile();
  const resolved = resolveParams([{ key: 'image', type: 'file', required: true }], { image: file });
  assert.equal(resolved.image, file);
});

test('enforces range min/max', () => {
  const param = { key: 'n', type: 'range', min: 0, max: 1 };
  assert.throws(() => resolveParams([param], { n: 2 }), /不能大于 1/);
  assert.throws(() => resolveParams([param], { n: -1 }), /不能小于 0/);
});

test('rejects values outside an enum', () => {
  assert.throws(
    () => resolveParams([{ key: 'm', type: 'enum', options: [{ value: 'a' }] }], { m: 'z' }),
    /不在可选项内/,
  );
});

test('files params are not supported yet', () => {
  assert.throws(
    () => resolveParams([{ key: 'images', type: 'files' }], { images: [] }),
    /批量/,
  );
});
