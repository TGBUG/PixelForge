# PixelForge — 领域文档 (CONTEXT)

本文件是 PixelForge 的术语表与架构共识。所有工程技能(见 `docs/agents/domain.md`)在探索本仓库前应先读它,并在产出(issue 标题、重构提案、假设、测试名)中**使用这里定义的词汇**,不要漂移到同义词。

> 决策的**理由**放在 `docs/adr/`;本文件只记录**术语**与**当前形态**。

---

## 这是什么

PixelForge 是一个图像处理**工具箱**:市面上的图像处理方法(如光棱坦克、番茄混淆、格式转换、压缩)大量分散、各自为政,没有统一入口。PixelForge 只提供一个 **JS 运行环境 + GUI**,把具体处理方法做成**可导入的插件包**加载进来。

核心场景:**启动 → 列出已安装插件 → 进入某个插件 → 该插件按自身表单渲染出输入项 → 运行 → 预览 → 保存**。它不是"打开编辑器再选底图"的模式,也没有跨插件的流水线(v1)。

## 术语表 (Glossary)

- **插件 / 扩展 (plugin / extension)** — 一个 ZIP 包,代表**一个**图像处理方法。包内必有 `plugin.json`(manifest)与入口 `index.js`。一个插件 = 一个方法。
- **方法 (method)** — 一种具体的图像处理,如"光棱坦克""大小番茄混淆""压缩""格式转换"。
- **manifest(表单文件)** — 包根固定的 `plugin.json`。含作者信息、`id`、`version`、`entry`、`params[]` 等;宿主据此渲染表单与校验。
- **entry / 入口** — `index.js`,导出 `run(ctx)`,由宿主 loader `import()` 后调用。
- **核心代码 (core code)** — 第三方项目里真正干活的那段算法。**契约化重写时通常不需要改动**。
- **契约化重写 (contract-wrapping)** — 把现成项目的核心代码包一层适配,使其满足 PixelForge 插件契约(index/ctx/IPC)。实践中的常态:别人的实现难以原样契合契约,但**核心代码往往照搬即可**。
- **表图 / 里图 (cover / secret)** — 双图方法的两个输入(如把"里图"藏进"表图")。它们在 manifest 里就是**两个普通 `file` 参数**,由作者自行声明。
- **批量轴 (batch axis)** — `files` 类型的参数。宿主据它**起 N 个并行子进程**,每个处理一个输入。
- **预览 (preview)** — 运行一次、在窗口里显示结果,**不点"保存"就不落盘**。
- **保存 (save)** — 把预览产物从临时工作目录**拷贝到用户选定的持久位置**。
- **workdir(工作目录)** — 每次运行创建的临时沙箱目录;输入被拷入 `workdir/in`,`workdir` 之外的文件插件不应触碰。会话结束/关闭时清理。
- **ctx(运行上下文)** — 宿主下发给插件的对象:`{ inputs, params, workdir, out }`。
- **registry(`registry.json`)** — 记录已安装插件(列表 / 安装时间 / 来源 / 版本)。**无启用/禁用开关**。
- **pixel 家族 / file 家族** — **已废弃**的旧区分(见 ADR-0003)。现已合并为单一"路径契约"子进程模型,不再有 `kind`。

## 架构概览

- **宿主 = Electron**(Node 宿主 + Chromium GUI)。原 Kotlin/JVM 骨架已弃用,见 ADR-0001。
- **仓库形态:两个 npm workspace 包。** `packages/runtime` = 插件运行时库(**零 Electron 依赖**,纯 Node 可导入,即主测试缝);`packages/app` = Electron 薄适配层(窗口/对话框/菜单 + 渲染层)。两者边界由 `packages/runtime/test/boundary.test.js` 守卫。开发/测试用夹具插件放在 `fixtures/plugins/`。
- **插件 = 一个无沙箱独立子进程**(`fork`),经 IPC(`process.send`)通信,见 ADR-0002。
- **契约:路径进、文件出。** 宿主拷输入进 workdir,插件读图、处理、写文件,输出**名与格式由插件决定**(因此"格式转换""压缩"这类改格式的方法天然成立)。
- **批量:宿主驱动。** `files` 起 N 个并行进程;多个 `files` 参数按**序号 zip 配对**,长度必须相等;单 `file` 对所有 item 复用同一值。并发上限/失败策略在**软件设置**(默认并发 4)。
  - *软性约定*:推荐插件保持"单输入",把批量交给宿主。运行时不强拦"插件内部自行批量",但参数词表里没有"文件夹"类型,故实际上很难表达——若确有需要,再讨论新增类型。

## 决策记录

- [ADR-0001 — 采用 Electron 作为宿主](docs/adr/0001-electron-host.md)
- [ADR-0002 — 插件 = 无沙箱独立子进程 + ctx/IPC 契约](docs/adr/0002-unsandboxed-subprocess-plugin-contract.md)
- [ADR-0003 — 合并 pixel/file 两种插件、取消实时预览](docs/adr/0003-merge-pixel-file-kinds.md)
