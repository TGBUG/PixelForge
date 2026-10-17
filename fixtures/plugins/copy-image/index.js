import fs from 'node:fs/promises';
import path from 'node:path';

const send = (message) => {
  if (typeof process.send === 'function') process.send(message);
};

export async function run(ctx) {
  const input = ctx.inputs.image;
  send({ type: 'log', message: `读取 ${path.basename(input)}` });

  const data = await fs.readFile(input);
  send({ type: 'progress', value: 0.5 });

  const fileName = `result${path.extname(input) || '.png'}`;
  await fs.writeFile(path.join(ctx.out, fileName), data);

  send({ type: 'progress', value: 1 });
  send({ type: 'log', message: `写出 ${fileName}` });
  send({ type: 'result', outputs: [`out/${fileName}`] });
}
