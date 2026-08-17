# 📖 dsh-novel-reader

> DSH Web 摸鱼小说阅读器 · 在 DeepSeek Harness Web 里悬浮一个轻量小说阅读面板，随时摸鱼。

[![npm version](https://img.shields.io/npm/v/dsh-novel-reader)](https://www.npmjs.com/package/dsh-novel-reader)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/dsh-plugin-%230a3d62)](https://github.com/ZhuSheng-0807/dsh-novel-reader)

一个为 **DeepSeek Harness (DSH) Web** 打造的悬浮小说阅读器插件：点击右下角半透明白色 📖 按钮即可展开阅读面板，看小说不用切窗口，摸鱼利器。

## ✨ 功能特性

- 📌 **悬浮按钮**：半透明白色图标按钮，可随意拖动位置；点击展开，Esc 一键收起
- 🪟 **自由缩放面板**：拖动面板边缘/角落即可调整窗口大小，拖拽标题栏移动位置（位置与大小自动记忆）
- 📑 **分页目录**：每页 20 章，自动定位到当前阅读章节所在页，支持页码直接跳转
- 🔖 **书架**：收藏多本小说，随时继续阅读；「最近阅读」历史一键回到上次位置
- 💾 **阅读进度**：章节 + 行内滚动位置双重保存，重启 DSH 后自动续读
- ⚡ **章节预缓存**：自动预取上一章/下一章，翻页秒开
- 🔍 **搜索换书**：按书名搜索小说，一键加入书架开始阅读
- 🎨 **原生风格**：UI 使用 DSH 设计 token（`--dsw-alias-*`），随 DSH 明暗主题自动适配
- 🏗️ **纯 JS 无构建**：无需 TypeScript/打包步骤，改完即用

## 🚀 安装

### 方式一：npm

```bash
dsh plugin --profile web add dsh-novel-reader
```

### 方式二：GitHub 直装

```bash
dsh plugin --profile web add github:ZhuSheng-0807/dsh-novel-reader
```

### 方式三：本地开发调试

```powershell
cd <dsh-home>\profiles\web
pnpm add file:D:\dsh-novel-reader
# 把 dsh-novel-reader 追加到 package.json 的 dsh.profile.bundles
# 重启 DSH-Web（client 半由 HMR 自动热更）
```

安装后重启 DSH（或刷新页面），右下角会出现半透明白色 📖 按钮。

## 📸 界面预览

_（待补充截图）_

## 🧱 架构

插件采用 DSH 标准的 **Dual-half** 结构，参照 `dshmarket` / `dsh-better-sidebar` 的写法：

```
dsh-novel-reader/
├── lib/index.js          # Host 半：/novel/* 同源 JSON API（抓取 + 解析）
├── lib/types/index.d.ts  # 类型声明
├── client/client.js      # Client 半：window.__ModuleLoader__ bundle（纯 JS）
├── cordis.patch.yml      # bundle 挂载补丁
├── package.json          # dsh 元数据（bundle/client 声明）
└── README.md
```

### Host 半（`lib/index.js`）

在 DSH webserver 注册 `/novel/*` 路由，以桌面 UA 抓取目标站并解析 HTML
（浏览器跨域 fetch 会被目标站 CORS 拦截，所以抓取放在 Host 侧）：

| 路由 | 说明 |
| --- | --- |
| `GET /novel/toc?book=<id>&page=<n>` | 分页目录 `{ book, author, page, pages, pageRanges, chapters[] }` |
| `GET /novel/chapter?url=...` | 章节正文 `{ title, content, prev, next }`（自动合并多页章节） |
| `GET /novel/search?q=...` | 按书名搜索 `{ results: [{ id, title, author, category }] }` |

### Client 半（`client/client.js`)

- 纯 JS `window.__ModuleLoader__.load({ id, factory })` bundle，**无需编译**
- 注册进 `shell.overlay` 槽位，用 `createPortal` 渲染到 `document.body`
  （脱离 overlay 容器 z-index 限制，不被其他插件盖住）
- 样式全部使用 DSH 设计 token，明暗主题自适应
- 阅读进度 / 书架 / 历史 / 面板位置大小存于 localStorage

## 🛠️ 开发与发布

**开发**：本插件是纯 JavaScript，改完 `lib/` 或 `client/` 后同步到
`<dsh-home>\profiles\web\node_modules\dsh-novel-reader\` 即可
（client 半由 DSH 的 client-hmr 自动热更新，host 半需重启后端）。

**发布到 npm**：

```bash
npm login
npm publish
```

**发布到插件市场**：在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
提交 PR，将本插件加入 `plugins.json` 即可被插件市场搜索到。

## ⚠️ 免责声明

- `/novel/*` 代理仅允许 `www.hongmengxsw.com` 及其子域（防 SSRF）
- 仅抓取免费公开小说网站的章节文本用于个人阅读，请尊重原作者版权，勿用于商业用途
- 阅读进度/书架数据仅存本机 localStorage，不上传任何服务器

## 📄 License

[MIT](LICENSE)
