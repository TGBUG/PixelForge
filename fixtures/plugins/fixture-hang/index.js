export async function run() {
  if (typeof process.send === 'function') {
    process.send({ type: 'progress', value: 0.1 });
  }
  // A pending promise alone does not keep Node alive; the interval does.
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
