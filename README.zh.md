# Archify HTML Preview

**[English](README.md)** | 简体中文

> 在笔记中点击 [Archify](https://github.com/tt-a1i/archify) 架构图缩略图，即可在应用内直接浏览其自包含的交互式 HTML —— 主题切换、平移缩放、搜索、Story 模式全部可用，无需离开 Obsidian。

![demo](demo/demo.visual-check.1440x900.light.png)

## 为什么做这个插件

Archify 输出的架构图是一组产物，在 Markdown 里通常这样引用：

```markdown
[![系统架构](diagrams/system-architecture.visual-check.1440x900.light.png)](diagrams/system-architecture.html)
```

「图片套链接」是合法的 CommonMark 语法，大多数 Markdown 预览器都能渲染缩略图并交互式打开链接的 HTML。但在 Obsidian 里，这条链路会在四处断开：相对路径的解析语义不同、默认不识别 `.html` 文件类型、没有内置 HTML 渲染器、普通 iframe 无法加载本地文件。

本插件恰好补齐这些断点：修复缩略图、识别 Archify 风格的链接，并在沙箱化的应用内预览中打开链接的 HTML。

## 功能特性

- **卡片识别** — 识别 `[![缩略图](x.png)](x.html)` 形式的链接，包括 Archify 的命名启发式（`*.visual-check.<宽>x<高>.<主题>.png` 且同目录存在 `*.archify.json`），悬停时显示「交互」徽标。
- **缩略图修复** — 以「相对笔记所在目录」的语义重新解析图片路径，即使 Markdown 里用的是 GitHub 风格的相对路径，缩略图也能正常显示。
- **一键交互预览** — 可在新标签页（默认）、模态窗、缩略图下方内联展开三种方式中打开。
- **源定义链接** — 预览工具栏提供「源定义」，可打开同名的 `.archify.json`。
- **默认沙箱隔离** — 运行于 `sandbox="allow-scripts"`（不透明源），图表永远无法触及你的库文件。
- **桌面与移动端通用** — 使用 Blob URL 而非 `file://`，两端行为完全一致（`isDesktopOnly: false`）。

## 示例

可运行的示例见 [`demo/demo.md`](demo/demo.md)：包含 Archify 引用格式的示例笔记、示例交互图（`demo.html`）和源定义（`demo.archify.json`）。

## 使用方法

无需修改笔记。任何「缩略图链接到 `.html` 文件」的写法（即 Archify 的标准输出格式）都会被自动增强：

```markdown
[![系统架构](architecture/diagrams/system-architecture.visual-check.1440x900.light.png)](architecture/diagrams/system-architecture.html)
```

点击缩略图即可在应用内打开交互版本。另提供命令：**在交互预览中打开当前 HTML 文件**。

## 安装

需要 Obsidian **1.4.0** 或更高版本。

### 从 Release 安装

从 [最新 Release](../../releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<库>/.obsidian/plugins/archify-html-preview/`，然后在 **设置 → 社区插件** 中启用本插件。

### 从源码构建

```bash
npm install
npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 拷入 `<库>/.obsidian/plugins/archify-html-preview/`。开发时可用 `npm run dev` 监听变更自动重建 —— 配合第三方 **Hot-Reload** 插件可实现自动重载。

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| 点击行为 | 新标签页 | 新标签页 / 模态窗 / 内联展开 |

三种界面各自提供恰如其分的操作：

| 界面 | 工具栏（右对齐） | 说明 |
|---|---|---|
| 新标签页 | 刷新 · 源定义 · 在浏览器打开 · 在新窗口打开 | 全尺寸视图 |
| 模态窗 | 刷新 · 源定义 · 在浏览器打开 · 在新窗口打开 | 拖标题移动、拖右下角缩放、用内置按钮关闭（无弹出窗口按钮 —— 本身已是模态） |
| 内联展开 | 源定义 · 在浏览器打开 · 在新窗口打开 · **收起** | 拖底部把手调整高度（会被记住） |

按钮右对齐，使用 Obsidian 原生控件样式。无论处于哪种模式，Ctrl/Cmd + 点击总是新标签页打开。

| 设置项 | 默认值 | 含义 |
|---|---|---|
| 接管 `.html` 文件 | 关 | 开启后双击 `.html` 文件也会打开交互预览（修改后需重载插件）。与 HTML Viewer / Polyglot Renderer 类插件互斥 |
| 允许同源 | 关 | 让被预览页面可以使用 `localStorage`，代价是失去不透明源隔离 |
| 内联高度 | 560px | 内联模式的 iframe 高度（拖底部把手调整，会被记住） |

交互产物常用的能力在预览中都能正常工作：

- **导出**（`canvas.toBlob` + `<a download>`）—— 沙箱授予 `allow-downloads`
- **分享类操作** —— 弹窗、模态（打印 / 确认）与表单均被允许
- **复制链接 / 复制节点** —— 不透明源里不存在 `navigator.clipboard`，预览会注入运行时垫片，经 `postMessage` 把文本转发到插件侧真正可用的剪贴板
- **状态持久化** —— 不透明源里 `localStorage` 会抛异常；垫片以内存存储兜底，产物照常工作

**在浏览器打开** 会把文件交给真正的浏览器，依次尝试：直接启动已知浏览器可执行文件（Edge / Chrome / Firefox，然后是系统打开器）、Obsidian 的 `openWithDefaultApp`、Electron 的 `shell.openPath` / `shell.openExternal`（各自与 1.2 秒超时竞速，避免桥接卡死吞掉整个操作）、最后是 `app://` 资源 URL。成功则静默；只有全部失败才提示 —— 并复制绝对路径，方便你粘贴到地址栏。

**在新窗口打开** 会把预览弹出为应用所有的独立系统窗口，不触碰系统 shell 或任何文件关联。

## 自定义样式

所有界面都暴露稳定的 CSS 钩子，供用户片段（`.obsidian/snippets/*.css`）使用：
`.archify-linked-html`、`.archify-badge`、`.archify-inline-wrap`、`.archify-inline-grip`、`.archify-preview-view`、`.archify-toolbar`、`.archify-preview-modal`、`.archify-frame-box`、`.archify-float`、`.archify-float-header`、`.archify-float-title`。所有颜色均走 Obsidian 主题变量，亮暗主题自动跟随。

## 已知限制

- 增强卡片（徽标 / 内联展开）作用于阅读视图与悬停预览；在实时预览中，点击依赖「接管 `.html` 文件」设置。
- 默认的不透明源沙箱下，预览内部无法使用 `localStorage` / `sessionStorage`（浏览器固有行为）。Archify 产物是自包含的，几乎不受影响；若图表确实需要存储，可开启「允许同源」。
- `.archify.json` 后缀以 `json` 结尾，无法注册为独立文件类型（扩展名注册只看最后一段）—— 因此只提供「源定义」快捷入口。

## 本地化

设置界面、命令、徽标与提示会跟随应用界面语言自动切换，目前内置：**English、简体中文、繁體中文、日本語**。
欢迎贡献更多语言 —— 在 [`src/i18n.ts`](src/i18n.ts) 中添加词典并注册到 `STRINGS` 映射即可。

## 项目结构

```
├── src/
│   ├── main.ts        # 插件入口：注册、Markdown 增强、点击路由
│   ├── resolve.ts     # 路径解析 + Archify 元数据解析
│   ├── settings.ts    # 设置接口、默认值、设置页
│   ├── view.ts        # 沙箱 iframe、ItemView、Modal、内联子组件
│   └── i18n.ts        # 本地化（en / zh / zh-TW / ja）
├── demo/              # 示例笔记 + 交互 HTML + 源定义
├── esbuild.config.mjs
├── manifest.json
├── styles.css
└── versions.json
```

## 发布（社区插件提交）

1. 升级 `manifest.json` 的 `version`，并同步 `versions.json`（`{"<版本>": "<minAppVersion>"}`）。
2. 推送与版本号完全一致的 tag（不带 `v` 前缀）—— 内置的 GitHub Actions 工作流会构建并把 `main.js`、`manifest.json`、`styles.css` 附加到 Release。
3. 向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提 PR，把本仓库加入 `community-plugins.json`，并遵循[插件指南](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)。

## 致谢

- [Archify](https://github.com/tt-a1i/archify) by tt-a1i —— 产出这些交互式架构图的 agent skill。

## 许可证

[MIT](LICENSE)
