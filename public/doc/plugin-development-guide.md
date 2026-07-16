# Qx 插件开发文档（作者手册）

> **这是插件作者的主入口。**  
> 写业务插件时优先读本文；需要字段级细节再下钻到协议专章。  
> 宿主贡献者另见 [`docs/plugin-architecture.md`](../docs/plugin-architecture.md)。

**状态**：Current · 适用：Qx ≥ 0.5.26（`context.cli`）· 读者：业务 / 第三方插件作者

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
| ③ | [`plugin-system.md`](./plugin-system.md) | manifest 全字段、context 全表、权限清单 |
| ④ | [`plugin-marketplace.md`](./plugin-marketplace.md) | 打进 `qx-plugins` 市场、Import/Browse |
| ⑤ | [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md) | Raycast 扩展转换（可选） |
| — | [`docs/plugin-architecture.md`](../docs/plugin-architecture.md) | 宿主 iframe / RPC 实现（非作者必读） |

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
| `panel.render` | 持久 UI、列表、按钮 | 泄漏定时器；操作宿主 DOM |

---

## 3. 接口抽象：端口目录（Port Catalog）

作者**只依赖端口**。宿主可换实现；插件代码不应依赖路径硬编码、Agent 开关或未声明权限。

### 3.1 选用哪条端口

| 场景 | 端口 | 权限 | 备注 |
|------|------|------|------|
| 跑本机工具（brew、release-cli、git） | **`context.cli`** | `cli` | **业务首选**；argv，无 shell |
| 调公司 HTTP API | **`context.http`** | `http` | 跨平台更稳 |
| 用户配置（路径、token） | **`context.getPreference`** | —（manifest.preferences） | 密钥用 `password` |
| 跨重启缓存 | **`context.storage.persist`** | — | 落盘 `data/storage.json` |
| 本次进程缓存 | **`context.storage.session`** | — | 重启即失 |
| Toast / 确认 | `showToast` / `prompt` | 可选 `notifications` | — |
| 打开网页 / CI | **`context.openUrl`** | `open-url` | — |
| 剪贴板 | **`context.clipboard`** | `clipboard` | — |
| 任意 shell 脚本 | `context.ai.runBash` | `ai-bash` | **慎用**；受 Agent Bash 门控 |
| LLM | `context.ai.*` | `ai` 等 | 见 AI 文档 |

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
await context.cli.which("brew")  // => "/opt/homebrew/bin/brew" | null

await context.cli.run({
  program: "brew",                 // 或绝对路径
  args: ["info", "--json=v2", "--installed"],
  cwd: optional,
  env: optional,                   // 合并进环境
  timeoutMs: 120_000,              // 默认 60s，最大 600s
})
// => { status, stdout, stderr, timedOut, program }
```

**规则**：永远 `program` + `args[]`，不要把用户输入拼进一条 shell 字符串。

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

#### 存储（详见宿主设计 [`docs/plugin-storage.md`](../docs/plugin-storage.md)）

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

已有 Raycast 扩展 → 转换器 / Import Raycast URL。  
新业务且强依赖本机 CLI 时，**手写 + `context.cli` 通常更稳**。

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

### 6.6 发布进度 Panel 骨架（思路）

1. `render`：工具栏 Refresh / Redeploy + 列表  
2. `load`：`cli.run({ program, args: ["status", "--json"] })` → `JSON.parse`  
3. Redeploy：`confirm` → `cli.run({ args: ["redeploy", "--id", id] })` → 再 Refresh  
4. 打开流水线：`openUrl(item.url)`  

完整可复制示例见仓库历史版本或市场 `brew` 的 `index.js` 结构（列表状态机 + `context.cli`）。

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

---

## 8. 清单：合并前自检

- [ ] `manifest.id` / `commands` / `export` 名称一致  
- [ ] `permissions` 覆盖所有 `context.*` 调用  
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
| **v2ex** | 原生 Qx 插件：`invoke:` 专用后端命令 |
| **raycast-*** | 转换插件：依赖 Raycast shim，适合 UI 型扩展 |

---

## 10. FAQ

**Import 支持哪些包？**  
标准 zip；扩展名 `.qx-plugin` 或 `.zip`。内含 `manifest.json` + 入口 `index.js`。

**为什么 GUI 里找不到 brew？**  
`context.cli` 会查 `/opt/homebrew/bin` 与 `/usr/local/bin`；仍失败则在 preferences 填绝对路径。

**Panel 打开是空白？**  
检查 `manifest.panel` + `export.panel.render`；看是否 throw；开 Dev Hot Reload 后 Rescan。

**和内置模块的关系？**  
内置模块走同一注册思路，但源码在主仓；**业务扩展一律外部插件**，不要改主仓塞业务。

---

## 11. 变更与版本

| 端口 / 能力 | 建议 `min_app_version` |
|-------------|------------------------|
| `context.cli` | **0.5.26+** |
| 二进制 HTTP `arrayBuffer` | 0.5.18+ |
| 基础 panel / storage | 按你目标发行版 |

协议变更应：**扩展字段、不改成功路径语义**；破坏性变更提高 `min_app_version` 并更新本文与 `plugin-cli-protocol.md`。
