export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

function requireString(raw, field) {
  const value = raw[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ManifestError(`manifest field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalString(raw, field, fallback) {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new ManifestError(`manifest field "${field}" must be a string`);
  }
  return value;
}

function parseAuthor(raw) {
  const value = raw.author;
  if (value === undefined) return { name: '', contact: '' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManifestError('manifest field "author" must be an object');
  }
  return {
    name: optionalString(value, 'name', ''),
    contact: optionalString(value, 'contact', ''),
  };
}

function parseManifestVersion(raw) {
  const value = raw.manifestVersion;
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) {
    throw new ManifestError('manifest field "manifestVersion" must be a positive integer');
  }
  return value;
}

// Minimal parse for T1: validates the fields the shell needs to display a plugin
// and hands `params` through untouched. Deep param validation lands with the
// parameter vocabulary (T5).
export function parseManifest(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError('manifest must be a JSON object');
  }
  const params = raw.params === undefined ? [] : raw.params;
  if (!Array.isArray(params)) {
    throw new ManifestError('manifest field "params" must be an array');
  }
  return {
    manifestVersion: parseManifestVersion(raw),
    id: requireString(raw, 'id'),
    name: requireString(raw, 'name'),
    version: requireString(raw, 'version'),
    author: parseAuthor(raw),
    description: optionalString(raw, 'description', ''),
    entry: requireString(raw, 'entry'),
    params,
  };
}
