export async function run() {
  process.stderr.write('夹具插件崩溃：强制退出\n');
  process.exit(2);
}
