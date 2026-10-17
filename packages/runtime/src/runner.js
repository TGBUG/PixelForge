import { fork, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside } from './path-utils.js';
import { resolveParams } from './params.js';

const LOADER = fileURLToPath(new URL('./plugin-loader.js', import.meta.url));
const STDERR_TAIL = 4096;

export async function removeWorkdir(workdir) {
  if (!workdir) return;
  await fsp.rm(workdir, { recursive: true, force: true });
}

function errorResult(workdir, kind, message, detail) {
  return {
    status: 'error',
    workdir,
    outputs: [],
    error: { kind, message, ...(detail ? { detail } : {}) },
  };
}

function cancelledResult(workdir) {
  return {
    status: 'cancelled',
    workdir,
    outputs: [],
    error: { kind: 'cancelled', message: '运行已取消' },
  };
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '_') || '_';
}

function resolveOutputs(list, workdir) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('result.outputs 必须是非空数组');
  }
  return list.map((relativePath) => {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('result.outputs 的条目必须是非空字符串');
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error(`输出路径必须是 workdir 相对路径：${relativePath}`);
    }
    const absolutePath = path.resolve(workdir, relativePath);
    if (!isInside(workdir, absolutePath)) {
      throw new Error(`输出路径越出 workdir：${relativePath}`);
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`输出文件不存在：${relativePath}`);
    }
    return { relativePath, absolutePath };
  });
}

// Resolves once the whole tree is gone, so callers can safely clean the workdir.
function killTree(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('close', resolve);
      killer.on('error', resolve);
    });
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Process group may already be gone.
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
  return Promise.resolve();
}

// Runs one plugin invocation in its own forked process. Returns a result object
// rather than throwing: `status` is 'success' | 'error' | 'cancelled'. Outputs
// stay inside the returned `workdir` until the caller saves them.
export async function runPlugin({
  manifest,
  pluginDir,
  params = {},
  timeoutMs = 0,
  signal,
  env = {},
  onEvent = () => {},
}) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelforge-run-'));
  const inDir = path.join(workdir, 'in');
  const outDir = path.join(workdir, 'out');
  await fsp.mkdir(inDir, { recursive: true });
  await fsp.mkdir(outDir, { recursive: true });

  let resolved;
  try {
    resolved = resolveParams(manifest.params, params);
  } catch (error) {
    return errorResult(workdir, 'invalid-params', error.message);
  }

  // Copy every file input into the sandbox, then point params at the copies so
  // no value handed to the plugin references a path outside the workdir.
  const inputs = {};
  let inputIndex = 0;
  try {
    for (const param of manifest.params ?? []) {
      if (param.type !== 'file') continue;
      const source = resolved[param.key];
      if (source == null) continue;
      const destination = path.join(
        inDir,
        `${inputIndex}-${safeSegment(param.key)}`,
        path.basename(source),
      );
      inputIndex += 1;
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(source, destination);
      inputs[param.key] = destination;
      resolved[param.key] = destination;
    }
  } catch (error) {
    return errorResult(workdir, 'input-copy', `输入拷贝失败：${error.message}`);
  }

  if (signal?.aborted) {
    return cancelledResult(workdir);
  }

  const ctx = { inputs, params: resolved, workdir, out: outDir };

  let child;
  try {
    child = fork(LOADER, [], {
      cwd: pluginDir,
      execArgv: [],
      // A separate process group lets POSIX cancel kill the whole tree.
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...env,
        PF_ENTRY: path.resolve(pluginDir, manifest.entry),
        PF_CTX: JSON.stringify(ctx),
      },
    });
  } catch (error) {
    return errorResult(workdir, 'spawn', `无法启动插件进程：${error.message}`);
  }

  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let killing = false;
    let stderr = '';
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    // Resolve only after the tree is killed, so the caller can remove the workdir.
    const stop = (result) => {
      killing = true;
      killTree(child).finally(() => {
        killing = false;
        finish(result);
      });
    };

    const onAbort = () => {
      cancelled = true;
      stop(cancelledResult(workdir));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        stop(errorResult(workdir, 'timeout', `运行超过 ${timeoutMs}ms 未完成`));
      }, timeoutMs);
    }

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });

    child.on('message', (message) => {
      if (settled || !message || typeof message !== 'object') return;

      if (message.type === 'log') {
        onEvent({
          type: 'log',
          level: message.level === 'error' || message.level === 'warn' ? message.level : 'info',
          message: String(message.message ?? ''),
        });
        return;
      }

      if (message.type === 'progress') {
        const value = Number(message.value);
        if (Number.isFinite(value)) onEvent({ type: 'progress', value });
        return;
      }

      if (message.type === 'error') {
        killTree(child);
        finish(errorResult(workdir, 'plugin-error', String(message.message || '插件报告错误'), message.stack));
        return;
      }

      if (message.type === 'result') {
        let outputs;
        try {
          outputs = resolveOutputs(message.outputs, workdir);
        } catch (error) {
          killTree(child);
          finish(errorResult(workdir, 'invalid-output', error.message));
          return;
        }
        killTree(child);
        finish({ status: 'success', workdir, outputs, error: null });
      }
    });

    child.on('error', (error) => {
      finish(errorResult(workdir, 'spawn', `无法启动插件进程：${error.message}`));
    });

    child.on('exit', (code, signalName) => {
      if (settled) return;
      // A cancel/timeout kill is still in flight; let `stop` resolve.
      if (killing) return;
      if (cancelled) {
        finish(cancelledResult(workdir));
        return;
      }
      if (timedOut) {
        finish(errorResult(workdir, 'timeout', `运行超过 ${timeoutMs}ms 未完成`));
        return;
      }
      if (code === 0) {
        finish(errorResult(workdir, 'no-result', '插件未返回 result 即退出'));
        return;
      }
      const tail = stderr.trim();
      const reason = `插件崩溃（退出码 ${code}${signalName ? `，信号 ${signalName}` : ''}）`;
      finish(errorResult(workdir, 'crash', tail ? `${reason}：${tail}` : reason, tail));
    });
  });
}
