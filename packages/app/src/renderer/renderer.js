const api = window.pixelforge;
const view = document.getElementById('view');

const state = {
  plugins: [],
  errors: [],
  plugin: null,
  values: {},
  run: null,
  notice: null,
};

// References to the live run panel, so log/progress events update in place.
let ui = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function blankRun() {
  return { id: null, status: 'idle', logs: [], progress: 0, outputs: [], error: null, saved: null };
}

function renderList() {
  view.replaceChildren();
  ui = null;
  const { plugins, errors, notice } = state;

  if (notice) view.append(el('div', 'notice', notice));

  const toolbar = el('div', 'toolbar');
  const installButton = el('button', 'primary', '安装插件…');
  installButton.type = 'button';
  installButton.addEventListener('click', installFromDialog);
  toolbar.append(installButton);
  view.append(toolbar);

  if (plugins.length === 0) {
    view.append(el('div', 'empty', '还没有任何插件。点「安装插件…」导入一个插件 ZIP。'));
    return;
  }

  const list = el('div', 'plugin-list');
  for (const plugin of plugins) {
    const manifest = plugin.manifest;
    const button = el('button', 'plugin');
    button.type = 'button';
    button.append(
      el('div', 'name', manifest.name),
      el('div', 'desc', manifest.description),
      el('div', 'meta', `${manifest.author.name} · v${manifest.version}`),
    );
    button.addEventListener('click', () => openPlugin(plugin));
    list.append(button);
  }
  view.append(list);

  if (errors.length > 0) {
    const box = el('div', 'warnings', `${errors.length} 个插件无法加载：`);
    const ul = el('ul');
    for (const error of errors) ul.append(el('li', null, error.message));
    box.append(ul);
    view.append(box);
  }
}

function openPlugin(plugin) {
  state.plugin = plugin;
  state.values = {};
  state.run = blankRun();
  state.notice = null;
  renderPlugin();
}

async function refreshPlugins() {
  const { plugins, errors } = await api.listPlugins();
  state.plugins = plugins;
  state.errors = errors;
  renderList();
}

async function installFromDialog() {
  const zipPath = await api.pickZip();
  if (zipPath) await installZip(zipPath);
}

async function installZip(zipPath) {
  try {
    const result = await api.installPlugin(zipPath);
    state.notice =
      result.status === 'installed'
        ? `已安装：${result.id} v${result.version}`
        : `安装失败：${result.message}`;
    await refreshPlugins();
    return result;
  } catch (error) {
    const message = String(error?.message || error);
    state.notice = `安装失败：${message}`;
    await refreshPlugins();
    return { status: 'error', message };
  }
}

async function uninstallCurrent() {
  const plugin = state.plugin;
  if (!plugin) return;

  try {
    const result = await api.uninstallPlugin(plugin.id);
    if (result.status === 'cancelled') return;
    state.notice =
      result.status === 'removed'
        ? `已卸载：${result.id}`
        : `卸载失败：${result.message || '未知错误'}`;
  } catch (error) {
    state.notice = `卸载失败：${String(error?.message || error)}`;
  }

  state.plugin = null;
  state.run = null;
  await refreshPlugins();
}

function canRun() {
  if (!state.plugin) return false;
  return state.plugin.manifest.params
    .filter((param) => param.type === 'file' && param.required)
    .every((param) => Boolean(state.values[param.key]));
}

function fileRow(param) {
  const row = el('div', 'field');
  row.append(el('label', null, `${param.label}${param.required ? ' *' : ''}`));
  if (param.description) row.append(el('p', 'desc', param.description));

  const line = el('div', 'field-line');
  line.append(el('div', 'path', state.values[param.key] || '未选择'));
  const pick = el('button', 'pick', '选择文件…');
  pick.type = 'button';
  pick.addEventListener('click', async () => {
    const selected = await api.pickFile(param.accept ?? []);
    if (selected) {
      state.values[param.key] = selected;
      renderPlugin();
    }
  });
  line.append(pick);
  row.append(line);
  return row;
}

function renderPlugin() {
  const manifest = state.plugin.manifest;
  const running = state.run.status === 'running';
  view.replaceChildren();

  const root = el('div', 'detail');
  const back = el('button', 'back', '← 返回插件列表');
  back.type = 'button';
  // Leave navigation disabled during a run so cancel stays reachable.
  back.disabled = running;
  back.addEventListener('click', () => {
    state.plugin = null;
    state.run = null;
    renderList();
  });
  root.append(back, el('h2', null, manifest.name));

  const dl = el('dl');
  for (const [label, value] of [
    ['作者', manifest.author.name || '（未署名）'],
    ['版本', manifest.version],
    ['说明', manifest.description || '（无说明）'],
  ]) {
    dl.append(el('dt', null, label), el('dd', null, value));
  }
  root.append(dl);

  const form = el('section', 'form');
  const fileParams = manifest.params.filter((param) => param.type === 'file');
  for (const param of fileParams) form.append(fileRow(param));
  if (manifest.params.some((param) => param.type !== 'file')) {
    form.append(el('p', 'note', '其余参数使用默认值；完整参数控件将在后续版本提供。'));
  }

  const actions = el('div', 'actions');
  const runButton = el('button', 'primary', running ? '运行中…' : '运行');
  runButton.type = 'button';
  runButton.disabled = running || !canRun();
  runButton.addEventListener('click', runCurrent);

  const cancelButton = el('button', 'back', '取消');
  cancelButton.type = 'button';
  cancelButton.hidden = !running;
  cancelButton.addEventListener('click', cancelCurrent);

  const uninstallButton = el('button', 'danger', '卸载插件');
  uninstallButton.type = 'button';
  uninstallButton.disabled = running;
  uninstallButton.addEventListener('click', uninstallCurrent);

  actions.append(runButton, cancelButton, uninstallButton);
  form.append(actions);
  root.append(form);

  const progressTrack = el('div', 'progress-track');
  const progressBar = el('div', 'progress-bar');
  progressBar.style.width = `${Math.round((state.run.progress || 0) * 100)}%`;
  progressTrack.append(progressBar);
  progressTrack.hidden = state.run.status === 'idle';
  root.append(progressTrack);

  const logBox = el('div', 'log');
  for (const line of state.run.logs) logBox.append(el('div', 'log-line', line));
  if (running || state.run.logs.length > 0) {
    root.append(el('h3', null, '日志'), logBox);
  }

  if (state.run.error) root.append(el('div', 'error', state.run.error));
  if (state.run.saved) {
    root.append(el('div', 'saved', `已保存：${state.run.saved.join('，')}`));
  }

  if (state.run.outputs.length > 0) {
    const preview = el('section', 'preview');
    for (const output of state.run.outputs) {
      const figure = el('figure', 'preview-item');
      if (output.dataUrl) {
        const image = document.createElement('img');
        image.src = output.dataUrl;
        image.alt = output.name;
        figure.append(image);
      } else {
        figure.append(el('div', 'note', '（该格式无法预览）'));
      }
      figure.append(el('figcaption', null, output.name));
      preview.append(figure);
    }
    const save = el('button', 'primary', '保存…');
    save.type = 'button';
    save.addEventListener('click', saveCurrent);
    preview.append(save);
    root.append(preview);
  }

  view.append(root);
  ui = { runButton, cancelButton, progressBar, progressTrack, logBox };
}

async function runCurrent() {
  if (!state.plugin || !canRun() || state.run.status === 'running') return;

  const plugin = state.plugin;
  const params = {};
  for (const param of plugin.manifest.params) {
    if (param.type === 'file') params[param.key] = state.values[param.key];
    else if (param.default !== undefined) params[param.key] = param.default;
  }

  const runId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.run = { ...blankRun(), id: runId, status: 'running' };
  renderPlugin();

  try {
    const result = await api.startRun({ runId, pluginId: plugin.id, params });
    if (state.run?.id !== runId) return;
    if (result.status === 'success') {
      state.run.status = 'success';
      state.run.outputs = result.outputs;
    } else if (result.status === 'cancelled') {
      state.run.status = 'cancelled';
      state.run.error = '运行已取消';
    } else {
      state.run.status = 'error';
      state.run.error = result.error?.message || '运行失败';
    }
  } catch (error) {
    if (state.run?.id === runId) {
      state.run.status = 'error';
      state.run.error = String(error?.message || error);
    }
  }

  if (state.run?.id === runId) renderPlugin();
}

async function cancelCurrent() {
  if (state.run?.id) await api.cancelRun(state.run.id);
}

async function saveCurrent() {
  if (!state.run?.id) return;
  try {
    const result = await api.saveRun(state.run.id);
    if (result.status === 'saved') {
      state.run.saved = result.saved;
    } else if (result.status === 'error') {
      state.run.error = result.message || '保存失败';
    }
  } catch (error) {
    state.run.error = String(error?.message || error);
  }
  renderPlugin();
}

api.onRunEvent((event) => {
  if (!state.run || event.runId !== state.run.id) return;
  if (event.type === 'log') {
    state.run.logs.push(event.message);
    if (ui) ui.logBox.append(el('div', 'log-line', event.message));
  } else if (event.type === 'progress') {
    state.run.progress = event.value;
    if (ui) {
      ui.progressTrack.hidden = false;
      ui.progressBar.style.width = `${Math.round(event.value * 100)}%`;
    }
  }
});

function startSmokePlugin(pluginId, inputPath) {
  const plugin = state.plugins.find((item) => item.id === pluginId);
  if (!plugin) return false;
  openPlugin(plugin);
  const fileParam = plugin.manifest.params.find((param) => param.type === 'file');
  if (fileParam) state.values[fileParam.key] = inputPath;
  renderPlugin();
  return true;
}

async function runSmoke(inputPath) {
  if (!startSmokePlugin('copy-image', inputPath)) return { status: 'missing-fixture' };

  await runCurrent();
  if (state.run.status !== 'success') {
    return { status: state.run.status, error: state.run.error };
  }

  const saved = await api.saveRun(state.run.id);
  state.run.saved = saved.status === 'saved' ? saved.saved : null;
  return {
    status: state.run.status,
    preview: state.run.outputs.some((output) => Boolean(output.dataUrl)),
    logs: state.run.logs.length,
    progress: state.run.progress,
    saved: saved.status === 'saved' ? saved.saved : null,
  };
}

async function runSmokeError(inputPath) {
  if (!startSmokePlugin('fixture-fail', inputPath)) return { status: 'missing-fixture' };
  await runCurrent();
  return { status: state.run.status, error: state.run.error };
}

async function runSmokeCancel(inputPath) {
  if (!startSmokePlugin('fixture-hang', inputPath)) return { status: 'missing-fixture' };

  const running = runCurrent();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await api.cancelRun(state.run.id);
  await running;
  return { status: state.run.status, error: state.run.error, progress: state.run.progress };
}

async function runSmokeInstall(zipPath) {
  const result = await installZip(zipPath);
  return {
    status: result.status,
    id: result.id ?? null,
    message: result.message ?? null,
    count: state.plugins.length,
    present: Boolean(result.id) && state.plugins.some((plugin) => plugin.id === result.id),
  };
}

async function runSmokeUninstall(id) {
  const result = await api.uninstallPlugin(id);
  await refreshPlugins();
  return {
    status: result.status,
    id,
    count: state.plugins.length,
    present: state.plugins.some((plugin) => plugin.id === id),
  };
}

function captureDetail(plugin) {
  const manifest = plugin.manifest;
  return {
    name: manifest.name,
    author: manifest.author.name,
    version: manifest.version,
    description: manifest.description,
  };
}

async function main() {
  const { plugins, errors } = await api.listPlugins();
  state.plugins = plugins;
  state.errors = errors;
  renderList();

  const query = new URLSearchParams(location.search);
  const smoke = query.get('smoke');
  let detail = null;
  let run = null;

  if (smoke === 'detail') {
    if (plugins[0]) {
      openPlugin(plugins[0]);
      detail = captureDetail(plugins[0]);
    }
  }

  if (smoke === 'run') {
    // Full chain: install through the app IPC, then enter and run the plugin.
    const zipPath = query.get('zip') || '';
    if (zipPath && !state.plugins.some((plugin) => plugin.id === 'copy-image')) {
      await installZip(zipPath);
    }
    const plugin = state.plugins.find((item) => item.id === 'copy-image') ?? state.plugins[0];
    if (plugin) {
      openPlugin(plugin);
      detail = captureDetail(plugin);
    }
    run = await runSmoke(query.get('input') || '');
  } else if (smoke === 'error') {
    run = await runSmokeError(query.get('input') || '');
  } else if (smoke === 'cancel') {
    run = await runSmokeCancel(query.get('input') || '');
  } else if (smoke === 'install') {
    run = await runSmokeInstall(query.get('zip') || '');
  } else if (smoke === 'uninstall') {
    run = await runSmokeUninstall('copy-image');
  }

  api.ready({ plugins: plugins.length, errors: errors.length, detail, run });
}

main();
