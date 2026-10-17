import fs from 'node:fs';
import path from 'node:path';

// Copies a run's outputs into a user-chosen directory. Saving is the only step
// that writes outside the workdir.
export function saveOutputs(outputs, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  return outputs.map((output) => {
    const destination = path.join(targetDir, path.basename(output.absolutePath));
    fs.copyFileSync(output.absolutePath, destination);
    return destination;
  });
}
