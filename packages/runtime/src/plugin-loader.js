// Child-process entry point. The host forks this file, passes the plugin entry
// and ctx through the environment, then waits for process.send messages.
import { pathToFileURL } from 'node:url';

const entry = process.env.PF_ENTRY;
const ctx = JSON.parse(process.env.PF_CTX || '{}');

function send(message) {
  return new Promise((resolve) => {
    if (typeof process.send !== 'function') return resolve();
    process.send(message, () => resolve());
  });
}

try {
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.run !== 'function') {
    throw new Error('插件入口必须导出 run(ctx)');
  }
  await module.run(ctx);
} catch (error) {
  await send({
    type: 'error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  process.exit(1);
}
