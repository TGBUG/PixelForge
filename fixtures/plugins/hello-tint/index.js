// Fixture plugin entry. Subprocess execution is out of scope for T1, so `run`
// is a placeholder that documents the contract it will eventually satisfy
// (see ADR-0002): read ctx.inputs, honour ctx.params, write into ctx.out.
export async function run() {
  throw new Error('hello-tint: 执行尚未实现（T1 仅搭建空壳与导航）');
}
