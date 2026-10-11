# ADR-0001：采用 Electron 作为宿主

- **状态**：Accepted
- **日期**：2026-10-11

## 背景

项目最初以 Kotlin/JVM 骨架起步(Gradle,`jvmToolchain 25`)——但这只是编辑器默认选择,**并非刻意**。与此同时,插件计划用 **Node 风格 JS** 编写,理由是市面上这些图像处理方法大多已有现成的 JS/Node 实现可供复用。

需要在高层的三种宿主方案间取舍:

- **Electron**(Node 宿主 + Chromium GUI)
- **Tauri**(Rust 壳)+ 把 Node 作为 sidecar
- **Kotlin/JVM** + 内嵌 Node sidecar

关键认识:图像应用的**计算吞吐不由宿主决定,而由后端库决定**。Node 有 `sharp`(libvips,C++ 原生)等高性能绑定;因此宿主选型主要权衡的是**桥接成本、启动/内存、GUI/预览能力**,而非原始算力。

## 决策

采用 **Electron**:

- 宿主即 Node,插件同语言,**零桥接**。
- Chromium 免费提供 GUI 与结果渲染。
- 重活交给 `sharp` 等原生库,吞吐无忧。
- **放弃**原 Kotlin/JVM 骨架。

## 后果

- **代价**:约 150–300MB 常驻内存、冷启动约 1s。对"图像工具箱"这一用途可接受,已确认接受此内存开销。
- **收益**:插件与宿主同构,无缝复用 Node 生态;无需维护跨语言桥。
- 若将来出现"极端在意体积/内存"的硬约束,再评估 **Tauri + Node sidecar**(需自建 Node↔Rust 桥,成本较高)。
