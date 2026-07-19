# Qx 插件开发文档（作者手册）

> **这是插件作者的主入口。**  
> 写业务插件时优先读本文；需要字段级细节再下钻到协议专章。  
> 宿主贡献者另见 [`docs/plugin-architecture.md`](../../docs/plugin-architecture.md)。

**状态**：Current · 适用：Qx ≥ 0.5.39（声明式 Workbench + Gallery + shell / Esc + storage / island）· 读者：业务 / 第三方插件作者

**模块端口总表（内置 + 市场）** → [`docs/module-port-inventory.md`](../../docs/module-port-inventory.md)
**市场仓库 Agent 地图** → `qx-plugins` 仓库根 [`AGENTS.md`](https://github.com/mcxen/qx-plugins/blob/main/AGENTS.md)（与本手册对照；**老包无 AGENTS.md 仍可安装**）

---

## 0. 一分钟心智模型

```text
┌─────────────────────────────────────────────────────────┐
│  Launcher 搜索 / Extensions 安装 / Panel 窗口            │  宿主 UI
└───────────────────────────┬─────────────────────────────┘
                            │ postMessage RPC
┌───────────────────────────▼─────────────────────────────┐
│  插件 iframe：index.js  export default { commands, panel }│  你的代码
│       只依赖 context.* 端口，不碰 OS / Node / 文件路径细节   │
└───────────────────────────┬─────────────────────────────┘
                            │ permissions 白名单
┌───────────────────────────▼─────────────────────────────┐
│  Rust 能力：cli · http · storage · clipboard · ai · …     │  宿主实现
└─────────────────────────────────────────────────────────┘
```

| 原则 | 含义 |
|------|------|
| **端口优先** | 业务只调 `context.cli` / `context.http` / `context.storage` 等稳定口 |
| **权限显式** | 能用的能力必须在 `manifest.permissions` 声明 |
| **沙箱** | 没有裸 `child_process`、没有任意 `file://`；CLI 用 `cli` 端口 |
| **可分发** | 一个 **zip / `.qx-plugin`** 即可 Import 或上市场 |

---

## 1. 文档地图（按需下钻）

| 顺序 | 文档 | 内容 |
|:----:|------|------|
| **①** | **本文** | 总览、端口、manifest、安装、调试、模式 |
| ② | [`plugin-cli-protocol.md`](./plugin-cli-protocol.md) | **`context.cli` 完整协议**（argv、超时、安全） |
| ②b | [`plugin-cli-gui.md`](./plugin-cli-gui.md) | **CLI→GUI**：`cli.json` / `ui.mountWorkbench` 与示例 |
| ②c | [`plugin-tray.md`](./plugin-tray.md) | **系统托盘能力**：`context.tray` + 指标拼实时标题 |
| ③ | [`plugin-system.md`](./plugin-system.md) | manifest 全字段、context 全表、权限清单 |
| ④ | [`plugin-marketplace.md`](./plugin-marketplace.md) | 打进 `qx-plugins` 市场、Import/Browse |
| ⑤ | [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md) | Raycast 扩展转换（可选） |
| — | [`docs/plugin-architecture.md`](../../docs/plugin-architecture.md) | 宿主 iframe / RPC 实现（非作者必读） |

---

## 2. 插件长什么样

### 2.1 目录与包

开发时（推荐）：

```text
~/.qx/plugins/<id>/
├── manifest.json      # 契约：id、权限、命令、面板、偏好
├── index.js           # ESM：export default { commands, panel? }
├── icon.png           # 可选
├── README.md          # 可选
└── data/              # 运行时生成：storage / preferences
```

分发时打成 **zip**（扩展名 `.qx-plugin` 或 `.zip` 均可）：

```bash
cd ~/.qx/plugins/my-plugin
zip -r ~/Desktop/my-plugin.qx-plugin manifest.json index.js icon.png README.md
```

用户安装：

1. **Settings → Extensions → Installed → Import**  
2. 填本地路径（如 `~/Downloads/my-plugin.qx-plugin`）→ **Install Local**  
3. 或填 GitHub / ZIP URL → **Install URL**  
4. 或从 **Browse** 市场安装  

宿主解压到 `~/.qx/plugins/<manifest.id>/`；同 id 覆盖安装。

### 2.2 导出契约（插件主接口）

```js
export default {
  // Launcher 可搜到的动作
  commands: [
    {
      name: "open",           // 与 manifest.commands[].name 对齐
      title: "Open My Board",
      async run(context) { /* 无 UI 或 toast */ },
    },
  ],

  // 可选：全屏 Panel（列表、设置、工作台）
  panel: {
    title: "My Board",
    async render(container, context) {
      // 只改 container 内部 DOM；定时器用 context.setTimeout
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
```

| 表面 | 职责 | 不要做 |
|------|------|--------|
| `commands[].run` | 短任务、打开面板提示、一次性 CLI | 长阻塞无反馈 |
| `panel.render` | 发布 Workbench 业务数据，或在确有需要时挂自定义 UI | 泄漏定时器；把可结构化的列表/详情重新手写 DOM |

### 2.2.1 插件模组模式（多种模块）

Qx 当前可运行 **5 条入口/执行链路**；它们可以组合在同一个插件包中：

| 链路 | Manifest / 入口 | 适合场景 |
|------|-----------------|----------|
| **Command** | `commands[]` → `commands[].run` | 一次性工具、toast、剪贴板、打开 URL |
| **Declarative Workbench** | `panel` → `panel.render` → `mountWorkbench(state, handlers)` | 标准列表 / Gallery、详情、搜索、Actions、Island；可订阅后台轮询 |
| **Custom panel** | `panel` → `panel.render(container, context)` | 画布、图表、媒体等无法结构化的复杂 UI |
| **Background interval** | `commands[].mode: "no-view"` + `interval` | 定时同步、壁纸、轮询任务；复用 command runtime |
| **Raycast conversion（Frozen）** | 保留的历史转换入口 | 仅研究/一次性实验；正式插件必须按 Qx 协议重写 |

`context.island`、Workbench `island`、`context.tray` 和通知属于输出表面/宿主能力，不单独算执行链路。CLI、HTTP、AI、storage 等属于业务数据能力，也不形成另一套 UI runtime。

| 模式 | 开发者写什么 | UI | 代表 |
|------|--------------|-----|------|
| **business**（推荐默认） | `mountWorkbench(state, handlers)` 发布列表、详情、Actions、Island 纯数据 | **宿主统一**（Qx 主题 / tabs / list / detail / Actions / island） | **Pomodoro**、**QxGH** |
| **custom panel** | 自绘 `container` DOM/CSS（仍建议用 `--qx-*` 变量） | 作者自控 | weather 卡片、复杂可视化 |
| **commands-only** | 仅 `commands[].run`（toast / 剪贴板 / 开 URL） | 无 panel | 一键工具 |
| **island + panel** | Workbench `island` 字段，或 panel 关闭时调用 `context.island` | 停靠由宿主呈现；桌面浮窗只由用户从 Qx 手动浮出并可关闭，右上定位、轮播与抢占由宿主决定 | pomodoro |

原则：**能 business 就 business**——只写业务映射（API → list items），不要复制壳 CSS。
Workbench 条目可带：`icon` · `image` · `badge` · `tone` · **`progress`（0–100）** · `detail` · `actions` · `raw`。`detail` 必须是结构化数据；Workbench 不接受 HTML。

Workbench 是受控业务端口：插件拥有最终业务 state，宿主拥有即时的输入、tab、选择、焦点和滚动反馈。`onQuery` / `onTab` / `onSelect` 先同步改 state + `paint()`，再启动可取消的慢任务；不要在回画前 `await`。每个 item 都必须提供稳定、唯一、非空的 `id`；宿主会直接拒绝缺失或重复项，不提供 title/index 兼容回退。`onAction` 直接使用宿主传入的 `selectedItem`，不要从可能滞后的闭包另猜当前项。完整事件与信任边界见 [`docs/plugin-architecture.md`](../../docs/plugin-architecture.md#声明式-workbench-端口)。

`mountWorkbench({ island })` 是一次声明式发布：宿主接受 Workbench state 后校验并投影同一个插件 island session，SDK 不再发送第二条独立 island RPC。需要在 Panel 关闭后持续更新时才直接调用 `context.island`；两条入口最终仍进入同一个宿主 session store。

### 2.2.2 声明式 Workbench（推荐）

```js
context.ui.mountWorkbench({
  layout: { kind: "gallery", columns: 4, aspectRatio: "landscape" }, // 可省略，默认 list
  query,
  tabs: [{ id: "all", label: "All", active: true }],
  items: rows.map((row) => ({
    id: row.id,
    title: row.name,
    subtitle: row.summary,
    badge: row.status,
    tone: row.ok ? "success" : "danger",
    detail: {
      title: row.name,
      fields: [
        { label: "Status", value: row.status },
        { label: "Updated", value: row.updatedAt },
      ],
    },
    actions: [{ id: "open", label: "Open", primary: true }],
  })),
  selectedId,
  actions: [{ id: "refresh", label: "Refresh", primary: !selectedId }],
  island: activeTask ? {
    primary: activeTask.name,
    secondary: activeTask.status,
    progress: activeTask.progress,
    countdown: { endsAt: activeTask.endsAt, durationMs: activeTask.durationMs },
    action: { label: "Pause", command: "pause-task", icon: "pause" },
  } : null,
  backgroundPoll: { command: "background-sync" },
}, {
  onSelect: (id) => { selectedId = id; paint(); },
  onAction: (id, item) => { /* local panel action */ },
  onCommandComplete: () => void reloadPersistedState(),
  onBackgroundPoll: () => void loadPersistedSnapshot(),
});
```

宿主负责：Qx 明暗主题、搜索/tabs、列表与详情、键盘选择/滚动、底栏主动作、右侧 Actions、Cmd/Ctrl+K，以及灵动岛停靠/浮出。插件负责：获取业务数据、选择 id、动作处理和状态持久化。

List / Gallery 的画布由宿主稳定保留：`items: []` 或少量结果不会折叠列表轨、详情分隔或 Gallery 区域。插件只需提供 `emptyText`，不要用占位假条目或自定义 CSS 撑开布局。

List 的 loading 反馈也由宿主管理：`loading: true` 且没有条目时显示标准骨架与 LoadingLabel；已有条目时继续呈现旧数据并在栏头显示 `…`。插件不要在刷新前清空仍然有效的缓存列表。

Action 有两条执行路径：

- `command: "manifest-command"`：宿主校验后在 command runtime 执行，适合计时器、下载等跨 panel 生命周期任务。
- 无 `command`：回调 `handlers.onAction`，适合当前 panel 的刷新、清筛选、清历史等局部操作。

command 与 panel 是不同 iframe runtime，不能用模块全局变量假装共享状态；跨 runtime 数据必须走 `context.storage.persist`。完整样板见市场插件 `pomodoro-island`。
Workbench 中带 `command` 的 action 完成后，宿主会调用 `onCommandComplete`；面板应在此读取一次持久化状态并回画，不要为了等待命令结果高频轮询磁盘。

### 2.3 面板注册（硬契约 — 避免 “Panel not registered”）

宿主 **`loadPlugin` 只在 `manifest.panel` 存在时** 向 registry 写入 `RegisteredPanel`。
仅有 `export default.panel` 而 **没有** manifest 字段 → 打开插件 tab 报 **Panel not registered**。

| 必须同时满足 | 说明 |
|--------------|------|
| `manifest.panel: { title, keywords? }` | 注册用 |
| `export default.panel.render(container, context)` | 渲染用 |
| 可选 `panel.destroy` | 清 timer / DOM |

**老包兼容**：纯 command / 纯 island、用户从不打开 panel tab 的包可以没有 `panel`；安装与跑 command 不受影响。
若 UI 把插件当「可打开模块」，作者必须补 panel（番茄钟 1.1.0 即此修复）。

### 2.4 缓存 / SWR 约定（网络型面板）

慢网络面板（天气、V2EX、壁纸列表等）推荐：

1. `render` **立刻**画出壳 + loading 或上次缓存
2. `context.storage.persist` 读 `{ data, savedAt }`
3. 未过 TTL → 先展示，后台刷新；过期失败 → 仍可展示 stale（grace）
4. 能复用宿主磁盘缓存的走 `invoke:`（如 `v2ex_fetch_topics`、`fetch_weather_for_location`），http 作回退

参考实现：**weather**、**v2ex** 市场插件 + 包内 `AGENTS.md`。

### 2.5 Esc 与宿主阶梯（打开插件时）

- 用户在插件 panel 内：iframe 先处理自己的 Esc（关详情等）
- 焦点不在 shell / 未 preventDefault：宿主 `performHostEscape` → 当前模块 `tryModuleEscapeStep`（PluginHost 的 `useQxModuleShell`）→ 回 launcher → 清搜索 → 隐藏窗口
- 插件**不要**再注册 process 级 Esc 监听抢宿主阶梯

---

## 3. 接口抽象：端口目录（Port Catalog）

作者**只依赖端口**。宿主可换实现；插件代码不应依赖路径硬编码、Agent 开关或未声明权限。

### 3.1 选用哪条端口

| 场景 | 端口 | 权限 | 备注 |
|------|------|------|------|
| 跑本机工具（brew、release-cli、git） | **`context.cli`** | `cli` | **业务首选**；`run`/`bash` 同步；`start`/`wait`/`cancel` 异步；`map` 有界并行；GUI 下 login PATH |
| 打开/揭示本地产物、读平台环境、设置壁纸 | **`context.system`** | `system` | `env` / `openPath` / `revealPath` / `setWallpaper`；与 `openUrl` 不同 |
| 系统托盘菜单项 | **`context.tray`** | `tray` | `setItems` / `clear`；点选可跑本插件 `command` |
| 调公司 HTTP API | **`context.http`** | `http` | 跨平台更稳 |
| 复用宿主领域命令（V2EX/天气缓存等） | **`context.invoke("…")`** | 精确 `invoke:<cmd>` 或能力组 | 优先走已缓存的 host 命令，再 http 回退 |
| 用户配置（路径、token） | **`context.getPreference`** | —（manifest.preferences） | 密钥用 `password` |
| 跨重启缓存 / SWR | **`context.storage.persist`** | — | 落盘 `data/storage.json`；**先画缓存再刷新** |
| 本次进程缓存 | **`context.storage.session`** | — | 重启即失 |
| 外部灵动岛 | **`context.island`** | `island` | show/update/dismiss；失败时 panel 仍须可用 |
| Toast / 确认 | `showToast` / `prompt` | 可选 `notifications` | — |
| 打开网页 / CI | **`context.openUrl`** | `open-url` | — |
| 剪贴板 | **`context.clipboard`** | `clipboard` | — |
| 任意 shell 脚本 | `context.ai.runBash` | `ai-bash` | **慎用**；受 Agent Bash 门控 |
| LLM | `context.ai.*` | `ai` 等 | 见 AI 文档 |

### 3.1.1 内置 React 端口 ↔ 插件端口（不要混用）

| 内置（宿主 React 模块） | 插件 iframe | 关系 |
|------------------------|-------------|------|
| `useQxModuleShell` / `useEscBack` / `moduleEscapeHost` | 无 React hook；打开 panel 时 **PluginHost** 包一层 QxShell，Esc leave → launcher | 插件**不** import 宿主 hooks |
| `useQxListSelection` / `useQxMasterDetail` | 自绘列表 + 键盘 | 可参考市场 **v2ex** 列表实现 |
| `QxModuleSearch` / `QxListLoading` | 自绘 input / skeleton | — |
| `invoke("fetch_weather…")` 等 | `context.invoke` 同名命令 | 宿主保留 API 给插件复用缓存 |

完整对照表：[`docs/module-port-inventory.md`](../../docs/module-port-inventory.md)。

### 3.2 核心端口形状（摘要）

#### UI / 会话

```ts
context.showToast(msg: string): void
context.prompt(label: string, default?: string): Promise<string | null>
context.getPreference(id: string): Promise<unknown>
context.setTimeout / setInterval / clearTimeout / clearInterval  // 面板销毁自动清理
```

#### CLI（完整协议 → [`plugin-cli-protocol.md`](./plugin-cli-protocol.md)）

```ts
// 权限: "cli"
await context.cli.which("brew")  // => "/opt/homebrew/bin/brew" | null（含 login PATH）
// 长任务 / 可取消 / 流式日志：
// const job = await context.cli.start({ kind: "run", program: "ffmpeg", args: [...] });
// await context.cli.wait(job.id, { onUpdate: (s) => { /* s.stdout */ } });
// 有界并行：await context.cli.map(items, async (x) => context.cli.run(...), { concurrency: 4 });
// 权限: "system"
// await context.system.openPath(outPath); await context.system.revealPath(outPath);
// await context.system.setWallpaper(outPath, { scope: "every" });
// 权限: "tray" — 往系统托盘加菜单（可选 command 为本插件 commands[].name）
// await context.tray.setItems([
//   { id: "mem", title: "Open dashboard", command: "open" },
// ]);

await context.cli.run({
  program: "brew",                 // 或绝对路径
  args: ["info", "--json=v2", "--installed"],
  cwd: optional,
  env: optional,                   // 合并进环境；默认已注入增强 PATH
  timeoutMs: 120_000,              // 默认 60s，最大 600s
})
// => { status, stdout, stderr, timedOut, program }

// 需要管道 / 通配符 / 完整 shell 时：
await context.cli.bash("brew list --formula | head -20")
await context.cli.bash({ script: "make release", cwd: "/path/to/proj" })

// CLI→GUI 助手（宿主注入，throw on failure）
const data = await context.cli.json({ program: "my-cli", args: ["list", "--json"] })
const rows = await context.cli.lines({ program: "my-cli", args: ["names"] })
const jobs = await context.cli.jsonBash("my-cli events --jsonl", { jsonl: true })

// 列表工作台 UI
context.ui.mountWorkbench({
  title: "My CLI",
  items: context.ui.itemsFromJson(data).map((item) => ({
    ...item,
    detail: { title: item.title, fields: [{ label: "Value", value: String(item.raw) }] },
  })),
}, { onSelect: (id, item) => { /* update selectedId + repaint */ } })
```

**规则**：优先 `program` + `args[]`；仅在需要 shell 语法时用 `cli.bash`。不要把不受信用户原文拼进 `script`。  
**CLI 产品化**：见 [`plugin-cli-gui.md`](./plugin-cli-gui.md) 与示例 `public/plugins/cli-workbench`。

#### HTTP

```ts
// 权限: "http"
const res = await context.http.fetch(url, {
  method: "GET",
  headers: { Authorization: `Bearer ${token}` },
  timeoutMs: 30_000,
});
const data = await res.json();
```

#### 存储（详见宿主设计 [`docs/plugin-storage.md`](../../docs/plugin-storage.md)）

四个命名空间，**不要混用**：

| 命名空间 | API | 生命周期 |
|----------|-----|----------|
| preferences | `getPreference` / Settings | 用户配置；升级保留 |
| persist | `storage.persist.*` | 跨重启业务 KV；升级保留 |
| session | `storage.session.*` | 进程内内存 |
| files | `plugin_file_*` 虚拟路径 | 大文件 / 缓存 |

```ts
await context.storage.persist.set("sync.cursor", { page: 2 })
await context.storage.persist.get("sync.cursor")
await context.storage.persist.keys()      // [{ key, bytes }]
await context.storage.persist.clear()     // 只清本插件 persist
await context.storage.session.set("pageCache", items)  // 仅本次进程
```

**升级/重装 zip 不会清空** preferences 与 persist / files；**卸载默认全删**。

### 3.3 端口分层（给架构读者）

```text
表现层     commands / panel DOM
    │
业务层     你的 parse / 列表状态 / 确认文案
    │
端口层     context.cli | http | storage | openUrl | …
    │
宿主层     Rust spawn / reqwest / 文件 KV  （插件不可见）
```

**反模式**：在插件里假设 Node、`require('fs')`、硬编码 `/Users/xxx`、用 `ai-bash` 代替 `cli`、在 `run` 里死循环。

---

## 4. Manifest 契约（最小够用）

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "…",
  "author": "you",
  "icon": "icon.png",
  "platforms": ["macos", "windows"],
  "keywords": ["demo"],
  "permissions": ["cli", "notifications", "open-url"],
  "preferences": [
    {
      "id": "cliPath",
      "label": "CLI path",
      "type": "string",
      "default": "my-cli",
      "description": "Binary name or absolute path"
    },
    {
      "id": "repos",
      "label": "Repositories",
      "type": "textarea",
      "default": "owner/repo",
      "rows": 4,
      "description": "owner/repo — one per line"
    }
  ],
  "commands": [
    {
      "name": "open",
      "title": "Open My Plugin",
      "description": "Open the panel",
      "keywords": ["my", "plugin"]
    }
  ],
  "panel": {
    "title": "My Plugin",
    "keywords": ["my plugin"]
  },
  "min_app_version": "0.5.26"
}
```

| 字段 | 要点 |
|------|------|
| `id` | 目录名 / 安装键；小写+连字符 |
| `permissions` | 与代码实际调用一致；宁少勿多 |
| `commands[].name` | 与 `export default.commands[].name` 一致 |
| `panel` | 需要工作台时声明；否则可省略 |
| `preferences[].type` | `string` / **`textarea`（多行）** / `password` / `number` / `boolean` / `select` |
| `platforms` | 如仅 macOS：`["macos"]`（例：Brew） |
| `min_app_version` | 使用新端口时钉住（`cli` → ≥ 0.5.26） |

权限全集见 [`plugin-system.md` §权限](./plugin-system.md)。

---

## 5. 从零到跑通

### 5.1 脚手架

**A. 应用内（推荐）**  
Settings → Advanced → **Create Plugin** → 生成 `~/.qx/plugins/<id>/`

**B. 手写**  
创建同上目录结构，写好 `manifest.json` + `index.js`，**Rescan**。

### 5.2 调试

| 步骤 | 操作 |
|------|------|
| 重载 | Extensions → **Rescan**，或 Advanced → **Dev Mode Hot Reload** |
| 打开 | Launcher 搜 `commands[].title` 或 panel 名 |
| 导入测 | 打 zip 后 **Import → Install Local** |
| 失败 | Panel 错误区 / 灵动岛 / toast；检查权限与 `min_app_version` |

### 5.3 发布给别人

1. `zip` → `.qx-plugin`  
2. 同事 **Import** 路径安装，**或**  
3. 提交到 [qx-plugins](https://github.com/mcxen/qx-plugins) 走市场（见 marketplace 文档）

---

## 6. 推荐实现模式

### 6.1 模式 A — 本机 CLI 工作台（Brew / 发布板）

```text
preferences: cli 路径、cwd
panel: 列表 + Refresh / 危险操作 confirm
context.cli.run({ program, args })
```

参考市场插件：**`brew`**（macOS，`permissions: ["cli", …]`）。

### 6.2 模式 B — HTTP 业务中台

```text
preferences: baseUrl、token (password)
context.http.fetch
跨 Windows / 无 bash 环境优先此模式
```

### 6.3 模式 C — 命令 only

仅 `commands` + toast / 剪贴板；无 `panel`。适合「查一下状态」。

### 6.4 模式 D — Raycast 转换

**暂停维护，不作为正式插件开发方式。** 转换器 / Import Raycast URL 仅为历史研究入口，不承诺适配新的 Raycast API。正式插件必须阅读上游源代码，使用 Qx `context.*`、Workbench、Actions 与 Island 协议重新实现。

### 6.5 最小 CLI 命令示例

```js
export default {
  commands: [
    {
      name: "cli-version",
      title: "Show CLI Version",
      async run(context) {
        const name = String((await context.getPreference("cliPath")) || "brew");
        const program = (await context.cli.which(name)) || name;
        const r = await context.cli.run({
          program,
          args: ["--version"],
          timeoutMs: 15_000,
        });
        if (r.timedOut) return context.showToast("Timed out");
        if (r.status !== 0) return context.showToast(r.stderr || `exit ${r.status}`);
        context.showToast((r.stdout || "").trim().slice(0, 120));
      },
    },
  ],
};
```

对应 manifest：`"permissions": ["cli", "notifications"]`。

### 6.6 灵动岛外接数据显示

manifest 添加 `"island"` 权限后，插件可发布一个由宿主渲染的数据表面：

```js
await context.island.show({
  primary: "Build #184",
  secondary: "Uploading artifacts",
  activity: "wave",
  action: { label: "Open", command: "open-build", icon: "open" },
});

await context.island.update({
  primary: "Build #184",
  secondary: "Complete",
  progress: 100,
  tone: "success",
});
```

不确定进度使用宿主 `activity`：`wave`（通用加载）、`dots`（轻量等待）、
`spinner`（短命令）或 `pulse`（持续采样）；拿到真实百分比后改发 `progress`，两者不要
同时提供。动画、切换过渡和 reduced-motion 均由 Qx 处理。

`action.command` 必须是当前插件 manifest 中声明的 command。插件不能控制窗口位置、
置顶或任务优先级；用户在 Settings → Appearance → External Island Display 决定是否
允许独立灵动岛、Qx 隐藏时是否保留以及是否置顶。即使开启，浮窗也只在用户从 Qx
底部灵动岛手动点击“浮出”后显示；插件发布或更新状态不会自动弹窗。首次位置为主屏
右上角，用户可拖动并由 Qx 持久化位置，插件不能读取或覆盖该坐标。

倒计时不要每秒重发 `secondary`。运行时发布绝对 `countdown.endsAt` 和可选
`durationMs`，暂停时发布固定 `remainingMs + paused: true`。Qx 会在 docked / floating
两种表面本地刷新 `MM:SS` 和进度条。Action 只使用宿主图标
`pause/play/stop/open` 与统一胶囊按钮；危险动作可加 `variant: "danger"`。
桌面悬浮态右侧的“缩小 / 展开”、“打开 Qx”和“关闭”属于宿主窗口控制：缩小后 Qx 会隐藏
插件 Action、保留核心状态与倒计时，展开后自动恢复。插件不需要也不能重复发布这些按钮。
用户关闭浮窗后，插件后续的倒计时或状态更新不会自动把它重新打开。
“打开 Qx”固定回到当前插件 Panel，目标由宿主绑定，插件不能传 route。

### 6.7 发布进度 Panel 骨架（思路）

1. `render`：工具栏 Refresh / Redeploy + 列表（**立即返回**；见下方超时规则）  
2. `load`：`cli.run({ program, args: ["status", "--json"] })` → `JSON.parse`（在 `render` 里 `void load()`，不要 `await`）  
3. Redeploy：`confirm` → `cli.run({ args: ["redeploy", "--id", id] })` → 再 Refresh  
4. 打开流水线：`openUrl(item.url)`  

完整可复制示例见市场 **`brew`** 的 `index.js`（列表状态机 + `context.cli`）。

#### Panel `render` 超时规则（必读）

宿主对 `panel.render` 有 **renderPanel 超时**（约 15s，仅覆盖首次挂载）。超时会 **拆掉 iframe** 并显示  
`Plugin <id> render failed: Plugin <id> renderPanel timeout`。

| 正确 | 错误 |
|------|------|
| `render` 里画出 loading UI，然后 `void state.reload()` | `await state.reload()` / `await context.cli.run(...)` 再返回 |
| 慢操作在后台跑，完成后二次 `render` | 等 `brew info` / HTTP 搜图完成才 resolve `render` |
| `destroy` 里标记 `state.dead`、清 timer，避免卸载后写 DOM | 忽略并发 reload / 面板已关仍 `innerHTML` |

命令 `run()` 可以长时间 `await`（用户命令默认 10s，可 `timeoutMs`；后台 120s）。**只有 panel 的 `render` 必须快返回。**

---

## 7. 后台 interval（可选）

仅当需要周期执行**无界面**任务时：

```json
{
  "name": "sync",
  "title": "Background Sync",
  "mode": "no-view",
  "interval": "1h"
}
```

- 宿主调度；过短 interval 会被策略限制（见 Bing 日更经验）  
- 搜索 / Extensions 可显示 **后台** 标签与最近执行时间  
- 不要用 interval 做「每分钟改系统状态」类骚扰行为  

### 7.1 Workbench 后台轮询

Workbench 视图会随 panel 关闭而销毁，因此后台工作必须绑定命令，而不是绑定视图回调：

```js
// manifest: { name: "background-sync", mode: "no-view", interval: "1m" }
// command: fetch/advance state, then context.storage.persist.set(...)
context.ui.mountWorkbench({
  items,
  backgroundPoll: { command: "background-sync" },
}, {
  onBackgroundPoll: () => void loadPersistedSnapshot(),
});
```

- 宿主校验该命令属于当前插件且确实是 interval/no-view 命令。
- panel 关闭、切回 Launcher 或 Qx 隐藏后，命令仍由插件后台 runtime 调度。
- Workbench 重新打开时必须先读持久化快照，不能等待下一次 poll。
- 计时器持久化绝对 `startedAt` / `endsAt`；不能依赖每秒累加变量。睡眠或进程重启后由后台 heartbeat 按时间戳结算。
- `onBackgroundPoll` 只通知当前打开的 Workbench 重读结果，不承担后台工作本身。

---

## 8. 清单：合并前自检

- [ ] `manifest.id` / `commands` / `export` 名称一致  
- [ ] **若可打开面板**：`manifest.panel` **且** `export.panel.render` 都有
- [ ] 包内建议带 **`AGENTS.md`**（Agent 维护用；老包可无，非安装门槛）
- [ ] `permissions` 覆盖所有 `context.*` / `invoke:` 调用
- [ ] 网络面板：persist 缓存或 host 缓存；`render` 不长时间 await
- [ ] 使用 `cli` 而非无必要的 `ai-bash`  
- [ ] CLI 用 argv；危险操作有 confirm  
- [ ] 密钥只在 preferences / 环境，不进仓库  
- [ ] `min_app_version` 覆盖所用端口  
- [ ] `platforms` 与真实依赖一致（如 brew → `macos`）  
- [ ] zip 导入一次、Rescan 一次、主路径手动点通  

---

## 9. 参考实现

| 插件 | 说明 |
|------|------|
| **brew** | 市场 macOS 插件：`context.cli` + Panel（list/search/outdated/upgrade） |
| **unsplash** | 市场插件：`context.http` 搜图 + 下载/设壁纸（Access Key；无 OAuth 点赞） |
| **v2ex** | `invoke:v2ex_*` + persist SWR + panel 详情；包内 AGENTS.md |
| **weather** | `invoke:fetch_weather*` + Open-Meteo http 回退 + persist SWR |
| **pomodoro-island** | panel 控制台 + `context.island`；**必须有 panel**（防注册失败） |
| **QxGH** (`qxgh`) | **business-only**：公开 `github.com` **HTML 页**解析 Actions/Releases → `mountWorkbench`（不用 REST API） |
| **raycast-*** | 转换插件：依赖 Raycast shim，适合 UI 型扩展 |

---

## 10. FAQ

**Import 支持哪些包？**  
标准 zip；扩展名 `.qx-plugin` 或 `.zip`。内含 `manifest.json` + 入口 `index.js`。

**为什么 GUI 里找不到 brew？**  
`context.cli` 会合并 **login shell PATH** + Homebrew/系统 bin，子进程默认带该 PATH。  
仍失败：preferences 填绝对路径，或用 `context.cli.bash`（`bash -lc`）。

**Panel 打开是空白 / “Panel not registered”？**
检查 **`manifest.panel` + `export.panel.render` 两者都有**（缺 manifest 字段就不会注册）。看是否 throw；Rescan / 重装 zip。包内见 `AGENTS.md`。

**老插件没有 AGENTS.md / panel 还能装吗？**
能。AGENTS 可选；无 panel 的包仍可跑 commands。仅当用户打开 panel tab 时才需要 panel 字段。

**`Plugin … renderPanel timeout`？**  
`panel.render` 里不要 `await` 慢 CLI/HTTP。先画 loading，再 `void load()`；见 §6.7 超时规则。市场 **brew ≥ 1.0.1** 已按此修复。

**和内置模块的关系？**  
内置模块走同一注册思路，但源码在主仓；**业务扩展一律外部插件**，不要改主仓塞业务。

---

## 11. 变更与版本

| 端口 / 能力 | 建议 `min_app_version` |
|-------------|------------------------|
| 声明式 Workbench、后台轮询与统一灵动岛动作 | **0.5.38+** |
| `context.system.setWallpaper` | **0.5.44+** |
| `context.cli` | **0.5.26+** |
| 二进制 HTTP `arrayBuffer` | 0.5.18+ |
| 基础 panel / storage | 按你目标发行版 |

协议变更应：**扩展字段、不改成功路径语义**；破坏性变更提高 `min_app_version` 并更新本文与 `plugin-cli-protocol.md`。
