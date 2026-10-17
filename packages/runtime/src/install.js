import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ManifestError, parseManifest } from './manifest.js';
import { PARAM_TYPES } from './params.js';
import { isInside } from './path-utils.js';
import { readRegistry, writeRegistry } from './registry.js';
import { extractZipSafe, UnsafeZipError } from './zip.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class InstallError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'InstallError';
    this.kind = kind;
  }
}

function isValidId(id) {
  return typeof id === 'string' && SAFE_ID.test(id);
}

function validateInstallable(manifest, dir) {
  if (!isValidId(manifest.id)) {
    throw new InstallError('invalid-manifest', `插件 id 非法：${manifest.id}`);
  }

  const entryPath = path.resolve(dir, manifest.entry);
  if (!isInside(dir, entryPath)) {
    throw new InstallError('invalid-manifest', `entry 越出插件目录：${manifest.entry}`);
  }
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new InstallError('missing-entry', `入口文件不存在：${manifest.entry}`);
  }

  const seen = new Set();
  for (const param of manifest.params) {
    if (!param || typeof param !== 'object' || Array.isArray(param)) {
      throw new InstallError('invalid-manifest', 'params 的每一项必须是对象');
    }
    if (typeof param.key !== 'string' || param.key.length === 0) {
      throw new InstallError('invalid-manifest', '参数缺少合法的 key');
    }
    if (seen.has(param.key)) {
      throw new InstallError('invalid-manifest', `参数 key 重复：${param.key}`);
    }
    seen.add(param.key);
    if (!PARAM_TYPES.has(param.type)) {
      throw new InstallError('invalid-manifest', `参数 ${param.key} 的类型非法：${param.type}`);
    }
  }
}

// Installs one plugin package (manifest at the ZIP root). Extraction happens in
// a staging directory and is only promoted to plugins/<id> once every check
// passes, so a rejected package leaves no trace.
export async function installPlugin({ zipPath, pluginsDir, source = path.basename(zipPath) }) {
  const staging = path.join(
    pluginsDir,
    `.staging-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    await extractZipSafe(zipPath, staging);

    const manifestFile = path.join(staging, 'plugin.json');
    if (!fs.existsSync(manifestFile)) {
      throw new InstallError('missing-manifest', 'ZIP 根目录缺少 plugin.json');
    }

    let manifest;
    try {
      manifest = parseManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
    } catch (error) {
      const message =
        error instanceof ManifestError ? error.message : `plugin.json 解析失败：${error.message}`;
      throw new InstallError('invalid-manifest', message);
    }

    validateInstallable(manifest, staging);

    const target = path.join(pluginsDir, manifest.id);
    const registry = readRegistry(pluginsDir);
    if (fs.existsSync(target) || Object.hasOwn(registry.plugins, manifest.id)) {
      throw new InstallError('duplicate-id', `插件 ${manifest.id} 已安装，拒绝覆盖`);
    }

    await fsp.rename(staging, target);

    try {
      registry.plugins[manifest.id] = {
        version: manifest.version,
        installedAt: new Date().toISOString(),
        source,
      };
      writeRegistry(pluginsDir, registry);
    } catch (error) {
      // Never leave an installed directory that the registry does not know about.
      await fsp.rm(target, { recursive: true, force: true });
      throw new InstallError('io', `登记插件失败：${error.message}`);
    }

    return { status: 'installed', id: manifest.id, version: manifest.version, dir: target };
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true });
    return {
      status: 'error',
      kind:
        error instanceof InstallError
          ? error.kind
          : error instanceof UnsafeZipError
            ? 'unsafe-path'
            : 'io',
      message: error.message,
    };
  }
}

export async function uninstallPlugin({ pluginsDir, id }) {
  if (!isValidId(id)) {
    return { status: 'error', kind: 'invalid-id', message: `插件 id 非法：${id}` };
  }

  const dir = path.join(pluginsDir, id);
  const registry = readRegistry(pluginsDir);
  const registered = Object.hasOwn(registry.plugins, id);
  const hasDir = fs.existsSync(dir);

  // Refuse to delete a directory that is neither registered nor a plugin.
  if (!hasDir && !registered) {
    return { status: 'error', kind: 'not-found', message: `插件 ${id} 未安装` };
  }
  if (hasDir && !registered && !fs.existsSync(path.join(dir, 'plugin.json'))) {
    return { status: 'error', kind: 'not-found', message: `插件 ${id} 未安装` };
  }

  try {
    if (registered) {
      delete registry.plugins[id];
      writeRegistry(pluginsDir, registry);
    }
    await fsp.rm(dir, { recursive: true, force: true });
    return { status: 'removed', id };
  } catch (error) {
    return { status: 'error', kind: 'io', message: `卸载失败：${error.message}` };
  }
}
