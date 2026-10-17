import { spawn } from 'node:child_process';

export async function run() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    env: { ...process.env },
  });
  if (typeof process.send === 'function') {
    process.send({ type: 'log', message: `child-pid=${child.pid}` });
  }
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
