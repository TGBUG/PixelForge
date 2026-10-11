const api = window.pixelforge;
const view = document.getElementById('view');
const state = { plugins: [], errors: [] };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderList() {
  view.replaceChildren();
  const { plugins, errors } = state;

  if (plugins.length === 0) {
    view.append(
      el('div', 'empty', '还没有任何插件。把插件包放进插件目录后回到这里。'),
    );
    return;
  }

  const list = el('div', 'plugin-list');
  for (const plugin of plugins) {
    const m = plugin.manifest;
    const button = el('button', 'plugin');
    button.type = 'button';
    button.append(
      el('div', 'name', m.name),
      el('div', 'desc', m.description),
      el('div', 'meta', `${m.author.name} · v${m.version}`),
    );
    button.addEventListener('click', () => renderDetail(plugin));
    list.append(button);
  }
  view.append(list);

  if (errors.length > 0) {
    const box = el('div', 'warnings', `${errors.length} 个插件无法加载：`);
    const ul = el('ul');
    for (const err of errors) ul.append(el('li', null, err.message));
    box.append(ul);
    view.append(box);
  }
}

function renderDetail(plugin) {
  const m = plugin.manifest;
  view.replaceChildren();

  const detail = el('div', 'detail');
  const back = el('button', 'back', '← 返回插件列表');
  back.type = 'button';
  back.addEventListener('click', renderList);
  detail.append(back, el('h2', null, m.name));

  const dl = el('dl');
  const rows = [
    ['作者', m.author.name || '（未署名）'],
    ['版本', m.version],
    ['说明', m.description || '（无说明）'],
  ];
  for (const [label, value] of rows) {
    dl.append(el('dt', null, label), el('dd', null, value));
  }
  detail.append(dl);

  detail.append(el('p', 'note', '运行与预览将在后续版本接入。'));
  view.append(detail);
}

async function main() {
  const { plugins, errors } = await api.listPlugins();
  state.plugins = plugins;
  state.errors = errors;
  renderList();

  // Smoke hook: `?smoke=detail` also opens the first plugin so the shell's
  // navigation can be verified without a display.
  let detail = null;
  const smoke = new URLSearchParams(location.search).get('smoke');
  if (smoke === 'detail' && plugins.length > 0) {
    const plugin = plugins[0];
    renderDetail(plugin);
    const m = plugin.manifest;
    detail = {
      name: m.name,
      author: m.author.name,
      version: m.version,
      description: m.description,
    };
  }

  api.ready({ plugins: plugins.length, errors: errors.length, detail });
}

main();
