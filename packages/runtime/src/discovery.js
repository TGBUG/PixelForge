import fs from 'node:fs';
import path from 'node:path';
import { parseManifest } from './manifest.js';

const MANIFEST_FILE = 'plugin.json';

// Scans a directory of plugin packages. Each direct child directory containing a
// valid `plugin.json` becomes a plugin summary `{ id, dir, manifest }`. A child
// that has no manifest is skipped; one whose manifest is malformed is reported in
// `errors` without aborting the scan. A missing directory yields an empty result.
export function discoverPlugins(pluginsDir) {
  const plugins = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { plugins, errors };
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(dir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifest = parseManifest(raw);
      plugins.push({ id: manifest.id, dir, manifest });
    } catch (err) {
      errors.push({ dir, message: err.message });
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, errors };
}
