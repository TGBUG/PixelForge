import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins, removeWorkdir, runPlugin } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'plugins');

// A valid 1x1 PNG, so outputs are real images the app can preview.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fixture(id) {
  const { plugins } = discoverPlugins(FIXTURES);
  const plugin = plugins.find((p) => p.id === id);
  assert.ok(plugin, `fixture "${id}" not found`);
  return plugin;
}

function tempInput(name = 'input.png') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-runner-input-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, PNG);
  return { dir, file };
}

function waitFor(predicate, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  })();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

test('runs a single-input fixture end to end', async (t) => {
  const plugin = fixture('copy-image');
  const input = tempInput();
  const events = [];

  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
    onEvent: (event) => events.push(event),
  });

  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'success');
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].relativePath, 'out/result.png');
  assert.ok(fs.existsSync(result.outputs[0].absolutePath));
  assert.deepEqual(fs.readFileSync(result.outputs[0].absolutePath), PNG);

  // The input was copied into workdir/in and still exists untouched at its source.
  const copied = findFile(path.join(result.workdir, 'in'), 'input.png');
  assert.ok(copied, 'input was not copied into workdir/in');
  assert.deepEqual(fs.readFileSync(copied), PNG);
  assert.ok(fs.existsSync(input.file));

  assert.ok(events.some((e) => e.type === 'log' && /读取/.test(e.message)));
  assert.ok(events.some((e) => e.type === 'progress' && e.value === 1));
});

test('hands the plugin only paths inside the workdir', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-echo-ctx-'));
  const dir = path.join(parent, 'echo-ctx');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({
      id: 'echo-ctx',
      name: 'Echo',
      version: '1.0.0',
      entry: 'index.js',
      params: [{ key: 'image', type: 'file', required: true }],
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    `import fs from 'node:fs';
import path from 'node:path';
export async function run(ctx) {
  fs.writeFileSync(path.join(ctx.out, 'ctx.json'), JSON.stringify(ctx));
  process.send({ type: 'result', outputs: ['out/ctx.json'] });
}`,
  );

  const { plugins } = discoverPlugins(parent);
  const plugin = plugins.find((p) => p.id === 'echo-ctx');
  const input = tempInput();
  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
  });

  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'success');
  const ctx = JSON.parse(fs.readFileSync(path.join(result.workdir, 'out', 'ctx.json'), 'utf8'));
  assert.ok(ctx.inputs.image.startsWith(result.workdir));
  assert.ok(ctx.params.image.startsWith(result.workdir));
  assert.equal(ctx.params.image, ctx.inputs.image);
  assert.ok(!ctx.params.image.includes(input.dir), 'original input path leaked to the plugin');
});

test('rejects a missing required file before spawning', async (t) => {
  const plugin = fixture('copy-image');
  const result = await runPlugin({ manifest: plugin.manifest, pluginDir: plugin.dir, params: {} });
  t.after(() => removeWorkdir(result.workdir));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'invalid-params');
  assert.match(result.error.message, /缺少必填参数/);
});

test('reports a plugin that throws', async (t) => {
  const plugin = fixture('fixture-fail');
  const input = tempInput();
  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
  });
  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'plugin-error');
  assert.match(result.error.message, /故意抛出/);
});

test('reports a crashing plugin with its stderr tail', async (t) => {
  const plugin = fixture('fixture-crash');
  const input = tempInput();
  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
  });
  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'crash');
  assert.match(result.error.message, /退出码 2/);
  assert.match(result.error.message, /崩溃/);
});

test('reports a plugin that exits without a result', async (t) => {
  const plugin = fixture('fixture-exit-silently');
  const input = tempInput();
  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
  });
  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'no-result');
});

test('times out a hanging plugin', async (t) => {
  const plugin = fixture('fixture-hang');
  const input = tempInput();
  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
    timeoutMs: 400,
  });
  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'timeout');
});

test('cancels a hanging plugin', async (t) => {
  const plugin = fixture('fixture-hang');
  const input = tempInput();
  const controller = new AbortController();

  const run = runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 200);
  const result = await run;

  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'cancelled');
});

test('cancelling kills the plugin process tree', async (t) => {
  const plugin = fixture('fixture-spawn-child');
  const input = tempInput();
  const controller = new AbortController();
  const events = [];

  const run = runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params: { image: input.file },
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  });

  const sawPid = await waitFor(() => events.some((e) => e.type === 'log' && /child-pid=\d+/.test(e.message)));
  assert.ok(sawPid, 'plugin never reported its child pid');
  const childPid = Number(events.find((e) => e.type === 'log' && /child-pid=\d+/.test(e.message)).message.match(/child-pid=(\d+)/)[1]);

  controller.abort();
  const result = await run;

  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(input.dir, { recursive: true, force: true }));

  assert.equal(result.status, 'cancelled');
  assert.ok(await waitFor(() => !isAlive(childPid)), `child process ${childPid} survived the cancel`);
});

test('rejects outputs that escape the workdir', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bad-output-'));
  const dir = path.join(parent, 'bad-output');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ id: 'bad-output', name: 'Bad', version: '1.0.0', entry: 'index.js', params: [] }),
  );
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    "export async function run() { process.send({ type: 'result', outputs: ['../escape.png'] }); }",
  );

  const { plugins } = discoverPlugins(parent);
  const plugin = plugins.find((p) => p.id === 'bad-output');
  const result = await runPlugin({ manifest: plugin.manifest, pluginDir: plugin.dir, params: {} });

  t.after(() => removeWorkdir(result.workdir));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  assert.equal(result.status, 'error');
  assert.equal(result.error.kind, 'invalid-output');
  assert.match(result.error.message, /越出 workdir/);
});
