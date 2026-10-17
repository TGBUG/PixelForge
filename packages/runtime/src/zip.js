import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { isInside } from './path-utils.js';

export class UnsafeZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeZipError';
  }
}

// yauzl rejects backslashes, absolute paths, and `..` segments itself, before
// it emits the entry. Reclassify those so callers see one error kind.
const YAUZL_UNSAFE = /^(invalid characters in fileName|absolute path|invalid relative path): /;

function asUnsafe(error) {
  if (error instanceof UnsafeZipError) return error;
  if (YAUZL_UNSAFE.test(error.message)) return new UnsafeZipError(error.message);
  return error;
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error) reject(error);
      else resolve(zipfile);
    });
  });
}

function openReadStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

// Rejects anything that would escape the destination before it is written:
// absolute paths, `..` segments (either slash style), and symlink entries.
function assertSafeEntry(entry) {
  const name = entry.fileName;
  if (!name) throw new UnsafeZipError('ZIP 中存在空文件名');

  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new UnsafeZipError(`ZIP 含绝对路径：${name}`);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new UnsafeZipError(`ZIP 含越界路径：${name}`);
  }

  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if ((mode & 0xf000) === 0xa000) {
    throw new UnsafeZipError(`ZIP 含符号链接：${name}`);
  }
}

export async function extractZipSafe(zipPath, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  const zipfile = await openZip(zipPath);

  await new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      try {
        zipfile.close();
      } catch {
        // Already closed by yauzl.
      }
      reject(asUnsafe(error));
    };

    zipfile.on('error', fail);
    zipfile.on('end', () => {
      if (!failed) resolve();
    });
    zipfile.on('entry', async (entry) => {
      if (failed) return;
      try {
        assertSafeEntry(entry);
        const destination = path.resolve(targetDir, entry.fileName);
        if (!isInside(targetDir, destination)) {
          throw new UnsafeZipError(`ZIP 路径越出目标目录：${entry.fileName}`);
        }
        if (entry.fileName.endsWith('/')) {
          await fsp.mkdir(destination, { recursive: true });
        } else {
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          const source = await openReadStream(zipfile, entry);
          await pipeline(source, fs.createWriteStream(destination));
        }
        zipfile.readEntry();
      } catch (error) {
        fail(error);
      }
    });

    zipfile.readEntry();
  });
}
