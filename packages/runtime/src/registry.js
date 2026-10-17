import fs from 'node:fs';
import path from 'node:path';

const REGISTRY_FILE = 'registry.json';

// A null-prototype map keeps ids like `constructor` from colliding with
// Object.prototype and makes `__proto__` a plain key if one is ever read.
function nullPrototypeMap(source = {}) {
  const map = Object.create(null);
  for (const [key, value] of Object.entries(source)) map[key] = value;
  return map;
}

export function readRegistry(pluginsDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginsDir, REGISTRY_FILE), 'utf8'));
    if (
      raw &&
      typeof raw === 'object' &&
      raw.plugins &&
      typeof raw.plugins === 'object' &&
      !Array.isArray(raw.plugins)
    ) {
      return { plugins: nullPrototypeMap(raw.plugins) };
    }
  } catch {
    // Missing or corrupt registry starts empty; installed dirs still count.
  }
  return { plugins: nullPrototypeMap() };
}

export function writeRegistry(pluginsDir, registry) {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const file = path.join(pluginsDir, REGISTRY_FILE);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`);
  fs.renameSync(temp, file);
}
