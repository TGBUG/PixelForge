export async function run() {
  if (typeof process.send === 'function') {
    process.send({ type: 'log', message: '夹具插件将故意失败' });
  }
  throw new Error('夹具插件故意抛出的错误');
}
