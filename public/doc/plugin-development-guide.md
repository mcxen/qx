# Qx 插件开发指南（业务场景上手）

面向**业务开发者**：在 Qx 里做一个自己的扩展（查发布进度、触发发布、打开流水线等），从零到可调试的最短路径。

> 更完整的协议与 API 表见文末「文档地图」。本文偏「怎么开始做」。

---

## 1. 文档在哪

| 文档 | 路径 | 给谁看 |
|------|------|--------|
| **本指南（上手）** | `public/doc/plugin-development-guide.md` | 业务插件作者 |
| 插件系统方案 | [`plugin-system.md`](./plugin-system.md) | manifest / context API / 权限 / 脚手架 |
| 市场发布 | [`plugin-marketplace.md`](./plugin-marketplace.md) | 打包到 `qx-plugins` 市场 |
| Raycast 转换 | [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md) | 把 Raycast 扩展转成 Qx 插件 |
| 内部运行时 | [`docs/plugin-architecture.md`](../docs/plugin-architecture.md) | 贡献宿主 / RPC 的人 |

应用内入口：

1. **Settings → Advanced → Create Plugin (`qx init`)**：生成模板到 `~/.qx/plugins/<id>/`
2. **Settings → Extensions → Rescan** / **Dev Mode Hot Reload**：改完代码立刻重载
3. Launcher 搜索命令标题 / 打开插件 Panel

插件落盘目录：

```text
~/.qx/plugins/<plugin-id>/
├── manifest.json
├── index.js          # ESM，export default { commands, panel }
├── icon.png          # 可选
├── README.md
└── data/             # 运行时：storage / preferences（宿主创建）
```

---

## 2. 先选形态

| 形态 | 适合 | 不适合 |
|------|------|--------|
| **命令 only** | 搜一下、跑一下 CLI、弹 toast | 要列表、多步操作 |
| **Panel（推荐业务场景）** | 列表展示进度、按钮「重新发布」、详情 | 极简一次性动作 |
| **Raycast 转换** | 已有 Raycast 扩展 | 全新业务、强依赖本机 CLI |

**发布进度 / 重新发布** → 建议：**Panel + 若干 Launcher 命令**。

---

## 3. 五分钟脚手架

### 方式 A：应用内生成（推荐）

1. 打开 Qx → Settings → Advanced  
2. **Create Plugin**，例如 id：`release-board`  
3. 打开 `~/.qx/plugins/release-board/`  
4. 编辑 `manifest.json` / `index.js`  
5. Settings → Extensions → **Rescan**（或开 Dev Hot Reload）

### 方式 B：手写目录

```bash
mkdir -p ~/.qx/plugins/release-board
# 写入 manifest.json + index.js（见下一节）
# 在 Qx Extensions 里 Rescan
```

打包给别人：

```bash
cd ~/.qx/plugins/release-board
zip -r ~/Desktop/release-board.qx-plugin manifest.json index.js icon.png README.md
# Settings → Extensions → 导入本地 .qx-plugin
```

---

## 4. 业务场景：代码发布进度 + CLI 重发

目标：

- Launcher 搜「发布进度」打开面板  
- 面板列出近期发布状态（读 CLI / HTTP）  
- 选中一条可 **刷新**、**打开流水线**、**重新发布**（再调 CLI）

### 4.1 `manifest.json`（声明能力）

```json
{
  "id": "release-board",
  "name": "Release Board",
  "version": "0.1.0",
  "description": "Query release progress and re-run publish via local CLI",
  "author": "your-team",
  "icon": "icon.png",
  "platforms": ["macos", "windows"],
  "keywords": ["release", "deploy", "ci", "发布", "流水线"],
  "permissions": [
    "notifications",
    "open-url",
    "cli"
  ],
  "preferences": [
    {
      "id": "cliPath",
      "label": "Release CLI",
      "type": "string",
      "required": true,
      "default": "release-cli",
      "description": "CLI binary name or absolute path (must be on PATH or absolute)."
    },
    {
      "id": "workdir",
      "label": "Working directory",
      "type": "string",
      "required": false,
      "default": "",
      "description": "cwd for CLI; empty = host default."
    },
    {
      "id": "statusArgs",
      "label": "Status command args",
      "type": "string",
      "required": false,
      "default": "status --json --limit 20",
      "description": "Args after CLI path for listing releases."
    },
    {
      "id": "redeployArgsTemplate",
      "label": "Redeploy args template",
      "type": "string",
      "required": false,
      "default": "redeploy --id {id}",
      "description": "Use {id} placeholder for selected release id."
    }
  ],
  "commands": [
    {
      "name": "open-board",
      "title": "Release Board",
      "description": "Open release progress board",
      "keywords": ["release", "deploy", "发布"]
    },
    {
      "name": "refresh-status",
      "title": "Refresh Release Status",
      "description": "Run status CLI once and toast summary",
      "keywords": ["release", "status"]
    }
  ],
  "panel": {
    "title": "Release Board",
    "keywords": ["release", "deploy", "发布"]
  },
  "min_app_version": "0.5.18"
}
```

**权限说明（必读）**

| 权限 | 用途 |
|------|------|
| **`cli`** | **`context.cli.run` / `which`** 跑本机 CLI（argv，无 shell；业务首选） |
| `open-url` | 打开 CI / 发布页 |
| `notifications` | toast / 系统通知 |

完整协议见 **[plugin-cli-protocol.md](./plugin-cli-protocol.md)**。

额外约束：

1. 需要 Qx 版本支持 `context.cli`（见协议文档 `min_app_version`）。  
2. 不要把密钥写进 `index.js`；用 `preferences` 的 `password` 类型或环境变量（由 CLI 自己读）。  
3. 跨平台业务优先 **HTTP API**（权限 `http`），CLI 适合 macOS 工具链（如 brew、本机 release-cli）。

> 仅当必须跑 shell 脚本时才用 `ai-bash` + `context.ai.runBash`（受 Agent 开关门控）。

### 4.2 `index.js`（最小可跑骨架）

```js
/** @param {import('../../src/plugin/types').PluginContext} context */
async function runCli(context, args) {
  const cli = String((await context.getPreference("cliPath")) || "release-cli").trim();
  const workdir = String((await context.getPreference("workdir")) || "").trim();
  const program = (await context.cli.which(cli)) || cli;
  const result = await context.cli.run({
    program,
    args: Array.isArray(args) ? args : String(args || "").split(/\s+/).filter(Boolean),
    cwd: workdir || undefined,
    timeoutMs: 60_000,
  });
  if (result.timedOut) throw new Error("CLI timed out");
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || `exit ${result.status}`).slice(0, 400);
    throw new Error(err);
  }
  return String(result.stdout || "");
}

function parseStatusOutput(stdout) {
  // Prefer JSON CLI: [{ id, name, status, url, updatedAt }, ...]
  try {
    const data = JSON.parse(stdout);
    return Array.isArray(data) ? data : data.items || [];
  } catch {
    // Fallback: one release id per line
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((id) => ({ id, name: id, status: "unknown" }));
  }
}

function renderBoard(container, context, state) {
  const rows = (state.items || [])
    .map((item, index) => {
      const active = index === state.selected ? "is-active" : "";
      return `<button type="button" class="row ${active}" data-index="${index}">
        <strong>${escapeHtml(item.name || item.id)}</strong>
        <span>${escapeHtml(item.status || "")}</span>
      </button>`;
    })
    .join("");

  container.innerHTML = `
    <style>
      .wrap { font: 13px system-ui; color: var(--qx-text-primary); padding: 12px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; }
      .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
      .toolbar button, .row { border: 1px solid var(--qx-border-1); background: var(--qx-bg-component-1); color: inherit; border-radius: 6px; padding: 6px 10px; cursor: pointer; font: inherit; }
      .list { overflow: auto; display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1; }
      .row { text-align: left; display: flex; justify-content: space-between; gap: 12px; }
      .row.is-active { outline: 1px solid var(--qx-accent); }
      .err { color: var(--qx-danger); white-space: pre-wrap; }
      .muted { color: var(--qx-text-secondary); }
    </style>
    <div class="wrap">
      <div class="toolbar">
        <button type="button" data-act="refresh">Refresh</button>
        <button type="button" data-act="open">Open pipeline</button>
        <button type="button" data-act="redeploy">Redeploy</button>
      </div>
      <div class="muted">${state.loading ? "Loading…" : `${(state.items || []).length} releases`}</div>
      ${state.error ? `<div class="err">${escapeHtml(state.error)}</div>` : ""}
      <div class="list">${rows || `<div class="muted">No releases</div>`}</div>
    </div>
  `;

  container.querySelector('[data-act="refresh"]')?.addEventListener("click", () => state.onRefresh());
  container.querySelector('[data-act="open"]')?.addEventListener("click", () => state.onOpen());
  container.querySelector('[data-act="redeploy"]')?.addEventListener("click", () => state.onRedeploy());
  container.querySelectorAll(".row").forEach((el) => {
    el.addEventListener("click", () => {
      state.selected = Number(el.getAttribute("data-index"));
      renderBoard(container, context, state);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadItems(context) {
  const args = String((await context.getPreference("statusArgs")) || "status --json --limit 20")
    .split(/\s+/)
    .filter(Boolean);
  const stdout = await runCli(context, args);
  return parseStatusOutput(stdout);
}

export default {
  commands: [
    {
      name: "open-board",
      title: "Release Board",
      async run(context) {
        context.showToast("Open Release Board from the plugin panel (search Release Board).");
      },
    },
    {
      name: "refresh-status",
      title: "Refresh Release Status",
      async run(context) {
        try {
          const items = await loadItems(context);
          const failed = items.filter((i) => /fail|error/i.test(String(i.status || ""))).length;
          context.showToast(`Releases: ${items.length}, failed: ${failed}`);
        } catch (error) {
          context.showToast(`Status failed: ${error.message || error}`);
        }
      },
    },
  ],

  panel: {
    title: "Release Board",
    async render(container, context) {
      const state = {
        items: [],
        selected: 0,
        loading: false,
        error: "",
        async onRefresh() {
          state.loading = true;
          state.error = "";
          renderBoard(container, context, state);
          try {
            state.items = await loadItems(context);
            state.selected = 0;
          } catch (error) {
            state.error = String(error.message || error);
          } finally {
            state.loading = false;
            renderBoard(container, context, state);
          }
        },
        async onOpen() {
          const item = state.items[state.selected];
          if (!item?.url) {
            context.showToast("No pipeline URL on selected item");
            return;
          }
          await context.openUrl(item.url);
        },
        async onRedeploy() {
          const item = state.items[state.selected];
          if (!item?.id) {
            context.showToast("Select a release first");
            return;
          }
          const ok = globalThis.confirm
            ? globalThis.confirm(`Redeploy ${item.name || item.id}?`)
            : true;
          if (!ok) return;
          try {
            const tmpl = String(
              (await context.getPreference("redeployArgsTemplate")) || "redeploy --id {id}",
            );
            const args = tmpl
              .replaceAll("{id}", String(item.id))
              .split(/\s+/)
              .filter(Boolean);
            await runCli(context, args);
            context.showToast(`Redeploy started: ${item.id}`);
            await state.onRefresh();
          } catch (error) {
            context.showToast(`Redeploy failed: ${error.message || error}`);
          }
        },
      };

      await state.onRefresh();
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
```

### 4.3 约定你们的 CLI

推荐 CLI 输出 **JSON**，宿主好解析：

```bash
# 查询
release-cli status --json --limit 20
# => [{"id":"42","name":"web@1.2.3","status":"success","url":"https://ci/.../42"}]

# 重发
release-cli redeploy --id 42
```

在插件 Preferences 里改 `cliPath` / `workdir` / 参数模板，不必改代码。

### 4.4 更稳的替代：HTTP 而不是 bash

若有发布中台 HTTP API：

```json
"permissions": ["http", "open-url", "notifications"]
```

```js
const res = await context.http.fetch("https://ci.example.com/api/releases", {
  headers: { Authorization: `Bearer ${await context.getPreference("token")}` },
});
const body = await res.json();
```

跨 Windows / 无 bash 环境更可靠；密钥用 `preferences` 的 `password` 字段。

---

## 5. 开发调试清单

1. **Rescan** 或开启 **Dev Mode Hot Reload**  
2. Launcher 搜插件名 / 命令标题  
3. 打开 Panel：看列表、点 Refresh  
4. 失败时看：  
   - Panel 底部错误 / Retry  
   - 灵动岛插件错误  
   - Settings → 是否授予 `ai-bash`、Agent Bash 是否开启  
5. CLI 先在系统终端验证同一 `cwd` 下可跑通，再接到插件  

**不要**用同步死循环或超长阻塞；`runBash` 设合理 `timeoutMs`，UI 先显示 Loading。

---

## 6. 安全与产品注意

| 原则 | 做法 |
|------|------|
| 最小权限 | 能 HTTP 就别要 `ai-bash` |
| 确认危险操作 | Redeploy / 删除前 `confirm` |
| 不写死密钥 | preferences / 环境变量 / 系统钥匙串由 CLI 处理 |
| 可审计 | toast / 日志带 release id，不把整段密钥打出来 |
| 后台任务 | 需要周期刷新时可用 `mode: "no-view"` + `interval`（见 Bing）；默认不要过短 |

---

## 7. 发布到市场（可选）

1. 目录放进 [qx-plugins](https://github.com/mcxen/qx-plugins) 仓库 `src/<id>/`  
2. `npm run package:plugins` 生成 `.qx-plugin` + `index.json`  
3. 用户从 Qx → Extensions → Browse / 导入安装  

细节见 [`plugin-marketplace.md`](./plugin-marketplace.md)。

---

## 8. 文档地图（深入）

```text
上手（本文）
  ├─ API / 权限 / hello-world     → plugin-system.md
  ├─ 市场打包                      → plugin-marketplace.md
  ├─ Raycast 扩展                  → raycast-plugin-conversion.md
  └─ 宿主实现 / 后台 badge 端口    → docs/plugin-architecture.md
```

---

## 9. 常见问题

**Q: 命令搜得到，面板打不开？**  
A: `manifest.panel` 与 `export default.panel.render` 都要有；Rescan 后看 Installed 是否 enabled。

**Q: `context.cli` 报缺权限 / 不存在？**  
A: manifest 加 `cli`，`min_app_version` 覆盖提供该协议的 Qx；Rescan。

**Q: Windows 上 CLI 跑不起来？**  
A: `cli` 是 argv spawn，不依赖 bash；仍须程序在 PATH。跨平台业务优先 HTTP。

**Q: 想和 Bing 一样后台自动刷？**  
A: 给 command 加 `"mode": "no-view", "interval": "1h"`（不要过短）；宿主会调度并显示「后台」标签。

**Q: 必须用 TypeScript 吗？**  
A: 不需要。iframe 里跑的是打包后的 ESM `index.js`；可用 TS 自己编成 JS 再放进插件目录。
