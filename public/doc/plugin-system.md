# Qx 插件系统方案

> **插件作者请先读** [`plugin-development-guide.md`](./plugin-development-guide.md)（端口抽象、上手、Import）。  
> 本文保留完整方案、字段表与权限清单，作参考手册。

## 一、现状

当前所有模块（clipboard、rss、macros 等）都是硬编码在 `App.tsx` 中的：

- 静态 `import`
- `switch(tab)` 渲染
- `doSearch()` 里写死关键词匹配

插件运行时和插件库已具备可用闭环：

- `PluginManager` 可扫描 `~/.qx/plugins/`，安装/卸载/启用/禁用外部插件，并渲染内置模块和外部插件 preferences。
- Installed 插件库支持搜索、`All / Built-in / External / Enabled / Disabled` 筛选、左侧列表 + 右侧详情。
- Browse 插件市场支持远程索引搜索、左侧列表 + 右侧详情、权限/元数据展示和安装状态反馈。
- 外部插件命令已经能注入 Launcher 搜索结果，插件 panel 通过 sandboxed iframe 渲染。

仍待继续收敛的是：把 `PluginManager` 拆分成更小的组件、补充插件库键盘列表导航，以及让更多内置模块从硬编码 React 路由迁移到统一注册接口。

---

## 二、目标架构

采用 **单文件 `.qx-plugin`（zip）+ iframe 沙箱 + postMessage RPC** 的插件方案。

```
~/.qx/plugins/my-plugin/
├── manifest.json          # 插件元数据 + 能力声明
├── index.js               # ESM 主入口，导出标准接口
├── icon.png               # 图标
└── data/
    ├── storage.json       # 插件私有 KV 存储
    └── preferences.json   # 用户偏好配置
```

分发时打包成：

```
my-plugin.qx-plugin  (zip)
├── manifest.json
├── index.js
└── icon.png
```

---

## 三、关键设计决策

| 维度 | 选择 | 理由 |
|------|------|------|
| 插件语言 | JavaScript/TypeScript | 与前端同栈，零额外运行时 |
| 分发格式 | 单文件 `.qx-plugin` zip | 安装/卸载/分享就是一个文件操作 |
| 加载方式 | `Blob URL` + `import()` | Tauri webview 安全模型不允许跨源 `file://` ESM 直接加载 |
| 隔离方式 | 第一期就上 iframe | 后补防护是灾难，权限白名单必须能真拦住 |
| 面板渲染 | iframe 作为容器 | 插件操作 iframe 内部 DOM，不污染主应用 |
| `context` | postMessage RPC | 隔离前提下的唯一选择，顺便强制契约化 |
| 内置模块 | 也走同一套注册接口 | 单一路径，减少硬编码 |
| 签名 | ed25519，作者本地生成密钥 | 验证插件完整性，**完全免费**，不需要 Apple 证书 |

### 为什么不直接用 `import("./index.js")` 读本地文件？

Tauri 生产环境前端是 `tauri://localhost`（或 `asset://`），`~/.qx/plugins/*/index.js` 是 `file://` 路径。webview 默认无法 ESM import 文件系统上的模块（CORS、MIME、绝对路径解析都有坑）。Vite 构建后所有 `import()` 也会被静态分析成 chunk，运行时拼出的本地路径根本不进 bundle 体系。

**正确做法**：后端把插件文件读成字符串，前端用 `Blob` 造 `blob:` URL，再 `import(blobUrl)`。这是 webview 里能跑通的动态 ESM。

---

## 四、manifest.json 规范

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A custom plugin for Qx",
  "author": "Your Name",
  "icon": "icon.png",
  "screenshots": ["screenshot-1.png", "screenshot-2.png"],
  "platforms": ["macos", "windows"],
  "keywords": ["hello", "test"],
  "permissions": ["clipboard", "http", "notifications", "open-url"],
  "entry": "index.js",
  "dependencies": ["rss"],
  "preferences": [
    {
      "id": "apiKey",
      "label": "API Key",
      "type": "password",
      "required": true
    }
  ],
  "commands": [
    {
      "name": "hello",
      "title": "Say Hello",
      "description": "Display a greeting",
      "keywords": ["hi", "greet"],
      "icon": "icon.png"
    }
  ],
  "shortcuts": [
    {
      "command": "hello",
      "key": "CommandOrControl+Shift+H",
      "enabled": true
    }
  ],
  "panel": {
    "title": "My Plugin",
    "icon": "icon.png",
    "keywords": ["my plugin"]
  },
  "min_app_version": "0.1.0",
  "pubkey": "...",
  "signature": "..."
}
```

字段说明：

- `id`：唯一标识，目录名
- `name` / `version` / `description`：展示用
- `author`：作者
- `icon`：相对路径
- `screenshots`：相对路径数组，用于 Installed 详情页预览图
- `platforms`：插件声明支持的平台，可选值为 `macos`、`windows`、`linux`。这是运行时
  执行边界而非展示标签：不匹配当前系统时仍可在 Settings 管理，但宿主不会创建该插件
  的 iframe、command/panel、后台任务或全局快捷键。执行边界使用 Rust 宿主返回的
  原生平台标识，不以 WebView user-agent 决定；平台 bridge 不可用时，对声明了平台的
  插件 fail closed。
- `min_app_version`：同样属于运行时执行边界；当前 Qx 版本低于声明值时保留安装与设置
  可见性，但不启动插件 runtime、后台任务或快捷键。宿主版本读取失败时对声明了最低
  版本的插件 fail closed，避免 bridge 异常意外放行较新的端口代码。
- `keywords`：全局搜索关键词；插件级关键词会自动合并进该插件的每条命令与 Panel。主搜索统一忽略大小写、Unicode 全/半角差异，并容忍空格、连字符、下划线、点号和斜杠等常见名称分隔符。
- `permissions`：插件可申请的能力，具体见权限表
- `entry`：入口文件，默认 `index.js`
- `dependencies`：依赖的其他插件 id（预留，用于加载顺序）
- `preferences`：用户在设置中可配置的项
- `commands`：出现在搜索结果中的命令列表
- `shortcuts`：可选，全局快捷键列表。`command` 对应命令 `name`，`key` 使用 Tauri global-shortcut 格式，例如 `CommandOrControl+Shift+V`
- `panel`：是否注册为一个可切换的全屏面板 tab
- `min_app_version`：最低 Qx 版本
- `pubkey` / `signature`：ed25519 签名（可选，建议开启）

---

## 五、插件 SDK 接口

插件 `index.js` 导出一个标准对象：

```js
export default {
  commands: [
    {
      name: "hello",
      title: "Say Hello",
      async run(context) {
        const name = await context.prompt("What's your name?");
        context.showToast(`Hello, ${name}!`);
      }
    }
  ],

  panel: {
    render(container, context) {
      container.innerHTML = `<h1>My Plugin Panel</h1>`;
    },
    destroy(container) {
      container.innerHTML = "";
    }
  }
};
```

### context API

| API | 说明 |
|-----|------|
| `context.invoke(cmd, args)` | 调用 Tauri 后端命令（受 `permissions` 限制） |
| `context.showToast(msg)` | 显示 toast 通知 |
| `context.prompt(label, defaultValue?)` | 弹出输入框 |
| `context.openUrl(url)` | 打开外部链接（需 `open-url` 权限） |
| `context.getPreference(id)` | 读取用户在设置中配置的偏好 |
| `context.display.raycastActionPanel` | 读取用户在 Settings -> Extensions -> Display 中配置的 Raycast ActionPanel 行内按钮显示偏好 |
| `context.clipboard.read()` | 读取系统剪贴板文本（需 `clipboard` 权限） |
| `context.clipboard.write(text)` | 写入系统剪贴板文本（需 `clipboard` 权限） |
| `context.ui.mountWorkbench(state, handlers)` | 声明式受控 panel：Qx 渲染 tabs、稳定的 List/Gallery 空态画布、结构化详情、Actions 与 island；宿主即时处理 query/tab/selection，manifest command 完成后回调 `onCommandComplete`；`backgroundPoll` 可绑定后台 interval command；只接受纯数据 |
| `context.island.show(input)` / `update(input)` / `dismiss()` | 在宿主灵动岛显示结构化数据、真实进度或 `wave/dots/spinner/pulse` activity、宿主倒计时与一个统一样式 command 动作（需 `island` 权限；桌面浮窗只能由用户从 Qx 手动浮出并可关闭；浮窗打开目标由宿主固定为当前插件 Panel） |
| `context.cli.run({ program, args?, cwd?, env?, timeoutMs? })` | **业务 CLI 首选**：argv 同步执行（需 `cli`；**不**走 AI Agent Bash）。协议见 [plugin-cli-protocol.md](./plugin-cli-protocol.md) |
| `context.cli.bash(script \| req)` | login-shell bash（需 `cli`） |
| `context.cli.which(program)` | 解析 PATH / Homebrew 常见路径上的可执行文件（需 `cli`） |
| `context.cli.start` / `poll` / `cancel` / `wait` / `listJobs` | **异步 CLI job**：可取消、边跑边读 stdout/stderr、并发上限（需 `cli`） |
| `context.cli.map(items, worker, { concurrency? })` | 有界并行 fan-out（需 `cli`） |
| `context.system.env()` | 平台 / home / temp / `dirSep` / `pathListSep` 等（需 `system`；旧 `pathSep` 是 `pathListSep` 的兼容别名） |
| `context.system.setWallpaper(path, options?)` | 通过宿主原生适配器设置 macOS / Windows 壁纸（需 `system`） |
| `context.system.openPath(path)` / `revealPath(path)` | 系统打开或在文件管理器中揭示路径（需 `system`） |
| `context.system.openSettings(section)` | 按 `about/display/storage/network/power/privacy/apps` 语义打开 macOS / Windows 系统设置（需 `system`） |
| `context.http.fetch(url, opts)` | 通过 Rust 后端发起真实 HTTP/HTTPS 请求（需 `http` 权限）；响应在所有平台统一提供 `body` / `bodyBase64` / `binary`、`text()` / `json()` / `arrayBuffer()` / `blob()` |
| `context.notification.show(input)` | 显示系统通知（需 `notifications` 权限） |
| `context.ai.providers()` | 读取 QxAI 可用 provider 和模型列表（需 `ai` 权限；自定义 provider 优先通过 API `/models` 获取） |
| `context.ai.models(provider?)` | 读取某个 provider 的模型列表，省略时返回默认 provider 模型（需 `ai` 权限） |
| `context.ai.defaultModel()` | 读取默认 provider/model 选择（需 `ai` 权限） |
| `context.ai.agentSettings()` | 读取 Settings -> AI Agent 中的全局 Agent 开关和工具配置（需 `ai` 权限） |
| `context.ai.chat(input, options?)` | 调用 QxAI 聊天能力，支持指定 provider/model 和图片输入（需 `ai` 权限） |
| `context.ai.stream(input, onChunk, options?)` | 流式接收 QxAI 文本输出 chunk（需 `ai` 权限） |
| `context.ai.runBash(script, opts?)` | 执行真实 bash 脚本并返回 stdout/stderr/status（需 `ai-bash` 权限，并受全局 Agent/Bash 开关约束） |
| `context.ai.search.grep(query, opts?)` | 使用用户配置的真实 `rg` / `grep` 后端搜索文本（需 `ai-tools` 权限，并受全局 Agent/Grep 开关约束） |
| `context.ai.memory.list()` | 列出用户可管理 AI 记忆（需 `ai-memory` 权限） |
| `context.ai.memory.add(text, tags?)` | 新增用户可管理 AI 记忆（需 `ai-memory` 权限） |
| `context.ai.memory.delete(id)` | 删除 AI 记忆（需 `ai-memory` 权限） |
| `context.ai.tasks.submit(input)` | 提交进程内后台 AI 任务，可在 Qx 隐藏到托盘后继续运行（需 `ai` + `ai-background` 权限） |
| `context.ai.tasks.list/get/cancel()` | 管理当前插件提交的后台 AI 任务（需 `ai-background` 权限） |
| `context.system.stats()` | 读取 CPU / MEM / GPU 运行监控（需 `system-stats` 权限） |
| `context.system.info()` | 读取系统信息（需 `system-info` 权限） |
| `context.system.storage()` | 读取磁盘存储信息（需 `system-info` 权限） |
| `context.system.network()` | 读取网络设备信息（需 `system-info` 权限） |
| `context.system.networkCounters()` | 读取统一的收发字节计数（需 `system-info` 权限） |
| `context.system.power()` | 读取跨平台电源/电池信息（需 `system-info` 权限） |
| `context.invoke("qx_external_displays_driver/list")` | 读取外接显示器 DDC/CI 驱动与显示器参数（需 `external-displays` 权限） |
| `context.invoke("qx_external_displays_set_control")` | 调节外接显示器亮度/对比度/音量（需精确 `invoke:qx_external_displays_set_control` 权限） |
| `context.system.processes.list()` | 读取进程列表（需 `processes` 权限） |
| `context.system.processes.kill(pid)` | 结束进程（需精确 `invoke:qx_system_information_kill_process` 权限） |
| `context.permissions.status()` | 读取 macOS 权限状态（需 `permissions` 权限） |
| `context.permissions.request(id)` | 申请 macOS 权限（需精确 `invoke:qx_permissions_request` 权限） |
| `context.permissions.openSettings(id)` | 打开 macOS 权限设置（需 `permissions` 权限） |
| `context.apps.search(query)` | 搜索系统应用（需 `apps` 权限） |
| `context.files.search(query, limit?)` | 搜索文件（需 `files` 权限） |
| `context.qx.invokeRust(cmd, args)` | 调用受控 Rust/Tauri 命令（需能力组、`invoke:<cmd>` 或 `*`） |
| `context.setTimeout/setInterval` | 面板生命周期定时器，面板销毁/插件卸载时自动清理 |
| `context.storage.get/set/delete(key)` | 持久 KV 兼容别名（= `persist.*`） |
| `context.storage.session.get/set/delete(key)` | 进程内临时 KV |
| `context.storage.persist.get/set/delete(key)` | 跨重启 KV（`plugin-data/<id>/storage.json`，升级保留） |
| `context.storage.persist.keys()` | 列举 persist 键与近似大小 |
| `context.storage.persist.clear()` | 清空本插件 persist KV |

存储布局与生命周期见 [`docs/plugin-storage.md`](../../docs/plugin-storage.md)。

AI 调用示例：

```js
export default {
  commands: [
    {
      name: "summarize",
      title: "Summarize with QxAI",
      async run(context) {
        const providers = await context.ai.providers();
        const provider = providers[0];
        const model = provider?.models[0];
        const text = await context.prompt("Text to summarize");
        if (!provider || !model || !text) return;

        const result = await context.ai.chat(text, {
          provider: provider.id,
          model: model.id,
          system: "Summarize in three short bullet points."
        });
        await context.clipboard.write(result);
        context.showToast("Summary copied");
      }
    }
  ]
};
```

图片多模态可使用 `images` 便捷参数，或直接传 OpenAI-compatible `content` parts。图片 URL 可以是远程 HTTPS URL，也可以是目标 provider 支持的 `data:image/...;base64,...`：

```js
const answer = await context.ai.chat({
  provider: "custom:openai",
  model: "gpt-4o",
  prompt: "What is in this screenshot?",
  images: ["data:image/png;base64,..."],
  imageDetail: "auto"
});

let streamed = "";
await context.ai.stream("Write a release note", (chunk) => {
  streamed += chunk;
  // Update your panel DOM here.
});
```

Bash 工具和记忆接口使用独立权限：

```js
const result = await context.ai.runBash("git status --short", {
  cwd: "/Users/me/project",
  timeoutMs: 10000
});

const matches = await context.ai.search.grep("TODO", {
  root: "/Users/me/project",
  maxResults: 50
});

await context.ai.memory.add("User prefers short Chinese answers", ["preference"]);

const task = await context.ai.tasks.submit({
  title: "Long summary",
  prompt: "Summarize this long document later",
  notify: true
});
```

---

## 六、权限系统

`permissions` 是一个字符串数组，常见值：

```
clipboard          访问剪贴板相关命令
http               发起真实 HTTP/HTTPS 请求
notifications      显示通知 / toast
island             使用受限的灵动岛数据表面（结构化文本、真实进度、一个 manifest command 动作）
ai                 使用 QxAI provider 目录、模型选择、文本和图片多模态聊天能力
ai-memory          读取、新增、删除用户可管理 AI 记忆
cli                业务插件 CLI：`run`/`bash`/`which` + 异步 jobs（`start`/`poll`/`cancel`/`map`），不依赖 Agent Bash
system             系统能力：`context.system.env` / `openPath` / `revealPath` / `openSettings` / `setWallpaper`
tray               系统托盘菜单：`context.tray.setItems` / `clear`（可点项映射到插件 command）
ai-bash            允许 AI/插件执行真实 bash 脚本（危险能力，需谨慎授予；业务优先用 cli）
ai-tools           允许 AI/插件调用非危险工具，例如用户配置的 rg/grep 搜索
ai-background      提交和管理 Qx 进程内后台 AI 任务
open-url           打开外部链接
storage            插件本地存储（默认已包含）
system-info        读取系统、存储、网络等静态系统信息
system-stats       读取 CPU / MEM / GPU 运行监控
external-displays  读取外接显示器 DDC/CI 驱动与显示器参数
processes          读取进程列表
apps               搜索系统应用
files              搜索文件
permissions        读取权限状态、打开系统设置
automation         读取录屏/宏等自动化状态
storage-management 读取 Qx 存储概览
invoke:<cmd>       调用某个具体的 Tauri 命令
*                  通配，允许所有（仅内部/调试插件使用）
```

实际执行时，前端 `handlePluginRpc` 会检查该插件 manifest 中的权限列表，未声明的调用会被拒绝。危险命令必须显式声明精确 `invoke:<cmd>` 权限，即使插件已经声明能力组也不会被隐式放行，例如结束进程、申请权限、清空数据、宏回放、录屏启动、文件导出/删除等。

Raycast generic shim 为兼容原扩展会声明一组精确文件桥权限，例如
`invoke:plugin_file_read_base64`、`invoke:plugin_file_write_base64`、
`invoke:plugin_file_exists`、`invoke:plugin_file_ensure_dir`、
`invoke:plugin_file_empty_dir` 和 `invoke:plugin_file_list`。这些命令允许
Raycast 转换插件访问真实绝对路径、`~/...` 路径和虚拟私有路径
`/qx-plugin-files/<plugin-id>`；`~/...`、`~\...` 以及虚拟路径后续部分的
正斜杠/反斜杠在 macOS、Windows 上具有同一层级语义。删除目录仍会拒绝根目录、用户 Home 和
`/tmp` 这类过宽路径。

Raycast generic shim 会把 `ActionPanel` 渲染成条目右侧的紧凑按钮，默认
显示，用户可在 Settings -> Extensions -> Installed -> Display 关闭。
插件面板左右缩窄时，shim 会优先隐藏这些按钮，保留主内容的可读空间。
`Detail` 视图的 `actions` 也会显示，因此转换后的日历、文档预览等详情型
扩展可以继续暴露复制、切换和设置入口。

转换器会把 Raycast dropdown / checkbox / password / text-like preferences
映射到 Qx manifest preferences，并在需要时安装扩展生产 npm 依赖。安装
依赖时禁用 lifecycle scripts；React / React DOM 始终复用 Qx converter
自身依赖，避免转换后扩展出现双 React hooks 运行时错误。

Raycast 转换插件可以在 manifest 中包含兼容报告：

```json
{
  "raycast": {
    "compatible": "generic-shim",
    "platformCompatibility": {
      "macos": {
        "status": "supported",
        "features": ["Raycast UI", "HTTP fetch", "AppleScript automation"]
      },
      "windows": {
        "status": "partial",
        "features": ["Raycast UI", "HTTP fetch"],
        "unsupported": ["AppleScript automation"]
      }
    }
  }
}
```

Settings -> Plugins -> Installed 会展示该报告。`partial` 表示主界面或部分动作可用，但某些 Raycast/macOS 能力会降级或不可用。

---

## 七、运行时架构

```
App 启动
  → 扫描 ~/.qx/plugins/*/manifest.json
  → 对 enabled 的插件：
      1. invoke("read_plugin_entry", {id}) 读取 index.js 文本
      2. new Blob([text], {type:"text/javascript"})
      3. URL.createObjectURL(blob)
      4. 创建 sandbox iframe，srcdoc 注入运行时 + import(blobUrl)
      5. iframe 加载完成后向父窗口发送 qx:plugin:loaded
      6. 父窗口把 commands[] 注册进搜索系统
      7. 若有 panel，注册为一个 tab
```

### 通信协议

父窗口与 iframe 通过 `postMessage` 通信：

- `qx:plugin:loaded` — iframe 报告加载成功
- `qx:plugin:error` — iframe 报告加载失败
- `qx:rpc` / `qx:rpc:response` — context API 调用
- `qx:runCommand` / `qx:runCommand:response` — 执行命令
- `qx:renderPanel` / `qx:renderPanel:response` — 渲染面板
- `qx:destroyPanel` / `qx:destroyPanel:response` — 销毁面板

> 内部实现细节（RPC 分发、AI 任务、权限模型、面板生命周期）见 [docs/plugin-architecture.md](../../docs/plugin-architecture.md)。

### 后台 interval 命令与标签

`mode: "no-view"` 且声明 `interval` 的命令（如 Bing Wallpaper 的 auto-switch）由宿主调度：

- 调度与 **最近/下次执行时间** 写入 `src/plugin/backgroundActivity.ts` 端口（localStorage + Zustand），**不**散落在各 UI 组件。
- Launcher 搜索结果、Extensions Installed 卡片/详情、插件 panel 顶栏共用 `PluginBackgroundBadge`：展示「后台 / 运行中」，悬停可见最近执行与下次计划。
- UI 只依赖 `usePluginBackgroundStore` / badge 组件；禁止在 ResultsList 或 Settings 里直接读 timer Map。

---

## 八、核心改造点

| 改造点 | 当前 | 目标 |
|--------|------|------|
| `App.tsx` 路由 | `switch(tab)` 硬编码 | 动态 tab 注册，插件可注册新 tab |
| `store.ts` Tab 类型 | 静态联合类型 | 扩展为 `string`，支持动态值 |
| `doSearch()` | 硬编码关键词匹配 | 插件 commands 注入搜索结果 |
| `PluginManager` | 已支持 Installed/Browse 插件库、导入、启用/禁用、卸载和偏好设置 | 继续拆分组件，补充键盘导航和大列表性能优化 |
| Tab 渲染 | 硬编码组件 | 对插件 panel，渲染到 iframe 容器中 |
| 内置模块 | 单独 import + switch case | 也走同一套注册接口 |

---

## 九、实现分期

### 第一期：命令插件（最小可用）

- [x] 定义 manifest 规范 + plugin 接口
- [x] 实现 Rust 后端命令：`list_installed_plugins`、`read_plugin_entry`、`set_plugin_enabled`、`plugin_storage_*`、`plugin_preferences_*`
- [x] 前端插件注册表 + iframe 沙箱 + postMessage RPC
- [x] 插件 commands 出现在搜索结果中，Enter 触发 `run()`
- [x] 基础 context：`invoke`、`showToast`、`openUrl`、`prompt`、`storage`
- [x] `Tab` 类型改为 `string`，`App.tsx` 支持动态插件 tab
- [ ] 内置模块渲染迁移到同一注册接口
- [x] CLI Workbench 协议示例（见 `plugin-cli-gui.md`）

### 第二期：面板插件 + 偏好设置

- [x] 插件 panel 注册为全屏视图
- [x] `PluginManager` 支持安装/卸载/启用/禁用（基于文件系统扫描）
- [x] preferences 在设置中渲染，用户可配置
- [x] `getPreference` 读取用户配置
- [x] 签名验证（ed25519）

### 第三期：开发者体验

- [x] `qx init` 脚手架命令，一键生成插件模板（Settings → Advanced → Create Plugin）
- [x] 开发模式：文件变更自动重载（Settings → Advanced → Dev Mode Hot Reload）
- [x] 业务向开发上手指南：[`plugin-development-guide.md`](./plugin-development-guide.md)
- [x] 插件市场 UI
- [x] 依赖加载顺序（拓扑排序）
- [x] Raycast 扩展转换器代码保留：`scripts/convert-raycast-extension.mjs`（Frozen / 暂停维护，仅历史实验）

---

## 十、后端命令清单

| 命令 | 说明 |
|------|------|
| `list_installed_plugins()` | 扫描并返回已安装插件列表 |
| `read_plugin_entry(id)` | 读取插件入口 JS 文本 |
| `install_plugin(path)` | 安装 `.qx-plugin` zip 包 |
| `uninstall_plugin(id)` | 卸载插件 |
| `set_plugin_enabled(id, enabled)` | 启用/禁用插件 |
| `plugin_storage_get(id, key)` | 读取插件存储 |
| `plugin_storage_set(id, key, value)` | 写入插件存储 |
| `plugin_storage_delete(id, key)` | 删除插件存储 |
| `plugin_preferences_get(id)` | 读取插件用户偏好 |
| `plugin_preferences_set(id, values)` | 写入插件用户偏好 |
| `plugin_clipboard_read()` | 读取系统剪贴板文本 |
| `plugin_clipboard_write(text)` | 写入系统剪贴板文本 |
| `plugin_http_fetch(req)` | 真实 HTTP/HTTPS 请求 |
| `plugin_notification_show(req)` | 显示系统通知 |
| `plugin_resolve_asset(id, asset_path)` | 将插件资源解析为可被 `convertFileSrc()` 使用的路径 |
| `fetch_plugin_index()` | 拉取远程插件索引 |
| `download_plugin(url)` | 下载插件包到临时目录 |
| `install_plugin_from_url(url)` | 从 GitHub repo、release asset 或 archive ZIP URL 下载并安装插件 |
| `install_raycast_extension_from_url(url)` | Legacy/Frozen：尝试转换 Raycast tree URL；正式插件不使用此发布路径 |
| `scaffold_plugin(name, outputDir)` | 在指定目录生成插件脚手架（manifest.json、index.js、README） |

---

## 十一、开发调试

**业务场景从零上手（推荐先读）**：[插件开发指南](./plugin-development-guide.md)  
（含：文档地图、脚手架、CLI 查发布进度 / 重新发布示例、权限与调试清单。）

### 热重载

在 Extensions 页面点击 `Rescan` 按钮可以重新扫描插件目录，无需重启应用。Installed 列表会保留当前搜索/筛选条件，并在插件增删后自动修正右侧选中项。

开启 Settings → Advanced → `Dev Mode Hot Reload` 后，插件文件变更会每 3 秒自动触发重载，方便开发调试。

### 脚手架

Settings → Advanced → `Create Plugin (qx init)` 可以一键生成插件模板，默认输出到 `~/.qx/plugins/<name>/`：

```
my-plugin/
├── manifest.json
├── index.js
└── README.md
```

生成后点击 Rescan 即可在 Installed 列表中看到新插件。

### 日志与错误

- 插件加载失败会在 Launcher 灵动岛显示错误详情。
- 单个插件加载失败、快捷键注册失败、命令运行失败不会影响其他插件。
- 插件面板 render/loading/timeout/error 状态会接入插件页自己的底部灵动岛，错误时显示 Retry。

---

## 十二、当前协议示例：Workbench

旧的入门示例已经移除，不再作为当前 Qx 插件开发参考。
当前可运行的协议示例是 [`public/plugins/cli-workbench`](../plugins/cli-workbench)，
完整说明见 [`plugin-cli-gui.md`](./plugin-cli-gui.md)。

市场仓库 `qx-plugins/src/sysinfo` 是不依赖 CLI 的完整业务示例：系统采集统一走
typed `context.system.*`，macOS / Windows 原生实现和系统设置 URL 都留在宿主，
插件只发布 Overview / Storage / Network / Processes 的 Workbench 纯数据。

---

## 十三、签名说明

签名使用 ed25519：

1. 作者本地运行 `qx sign` 生成密钥对（免费）
2. 公钥写入 manifest `pubkey`
3. 打包时对 zip 内容哈希后用私钥签名，写入 manifest `signature`
4. Qx 安装时用 `pubkey` 验签，失败则拒绝加载

这不是 Apple 开发者证书签名，不需要任何费用。
