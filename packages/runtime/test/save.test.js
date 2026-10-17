import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveOutputs } from '../src/index.js';

test('copies outputs into the target directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-save-'));
  const source = path.join(root, 'result.png');
  fs.writeFileSync(source, 'image-bytes');
  const target = path.join(root, 'target');

  const saved = saveOutputs([{ relativePath: 'out/result.png', absolutePath: source }], target);

  assert.deepEqual(saved, [path.join(target, 'result.png')]);
  assert.equal(fs.readFileSync(saved[0], 'utf8'), 'image-bytes');
});
