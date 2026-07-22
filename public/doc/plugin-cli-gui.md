# Workbench：把结构化业务能力产品化成 Qx 插件

> 配套：[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)（spawn 协议）·
> [`plugin-development-guide.md`](./plugin-development-guide.md)（作者手册）·
> 示例插件：`public/plugins/cli-workbench`

目标：把 CLI、HTTP 或宿主系统 API 返回的结构化数据变成 **可搜索、可点选、可确认**
的 Qx 界面。Workbench 不是 CLI 专用壳；CLI 只是其中一种数据源。Sysinfo 这类完全不
依赖 shell 的模块同样复用 List / Detail / tabs / Actions。

---

## 1. 分层抽象

```text
┌─────────────────────────────────────────────┐
│  panel / commands  UI（list · detail · toast）│  你写的业务
└──────────────────────┬──────────────────────┘
                       │ context.ui.*
┌──────────────────────▼──────────────────────┐
│  Workbench kit：esc / list+detail / JSON 渲染 │  宿主注入
└──────────────────────┬──────────────────────┘
                       │ context.cli.json / lines / ensure
┌──────────────────────▼──────────────────────┐
│  数据适配层：CLI / HTTP / context.system       │  宿主端口
└──────────────────────┬──────────────────────┘
                       │ context.cli.run / bash / which
┌──────────────────────▼──────────────────────┐
│  平台层：进程 / 网络 / macOS·Windows API       │  Rust
└─────────────────────────────────────────────┘
```

| 层 | 职责 | 不要做 |
|----|------|--------|
| **平台** | 进程、网络、系统信息、设置入口的 OS 适配 | 在插件里猜 OS 路径、PowerShell 或 AppKit URL |
| **数据** | CLI stdout、HTTP 或 typed system model → 领域数据 | 到处 `JSON.parse` + 手写 exit 检查 |
| **UI kit** | 列表 + 详情壳、转义、KV/JSON 展示 | 每插件复制 200 行 CSS |
| **业务** | 领域模型、危险操作 confirm、偏好 | 阻塞 `panel.render` |

---

## 2. 宿主注入的解析 API（`context.cli`）

权限：`cli`（与 `run` 相同）。

| 方法 | 行为 |
|------|------|
| `run` / `bash` / `which` | 底层 spawn（见协议文档） |
| **`ensure(req)`** | 同 `run`，超时或非 0 退出 **throw** |
| **`json(req)`** | `ensure` + 解析 stdout 为 JSON；`jsonl: true` 为 JSON Lines |
| **`lines(req)`** | `ensure` + 按行切分 |
| **`text(req)`** | `ensure` + trim 文本 |
| **`jsonBash(script)`** | `bash` + 解析 JSON |
| `parseJson` / `parseJsonLines` | 纯解析，不 spawn |

### JSON 案例

```js
// 工具打印标准 JSON 数组
const packages = await context.cli.json({
  program: "brew",
  args: ["info", "--json=v2", "--installed"],
  timeoutMs: 180_000,
});
// packages.formulae / packages.casks …

// 管道 / 临时脚本
const jobs = await context.cli.jsonBash(
  `my-cli status --json | head -c 200000`,
);

// JSONL（一行一个对象）
const events = await context.cli.jsonBash(
  `my-cli events --jsonl --limit 50`,
  { jsonl: true },
);
```

`parseJson` 会容忍 stdout 前有少量日志：取第一个 `{` / `[` 起解析。

### 行文本案例

```js
const outdated = await context.cli.lines({
  program: "brew",
  args: ["outdated", "--formula"],
});
// ["git", "node", ...]
```

### 错误处理

```js
try {
  await context.cli.ensure({ program: "deploy", args: ["--prod"] });
  context.showToast("Deployed");
} catch (e) {
  context.showToast(String(e.message || e)); // 已含 stderr 摘要
}
```

---

## 3. 宿主注入的 UI kit（`context.ui`）

无额外权限。Workbench 只接受纯数据，样式与交互全部由 Qx 宿主提供。

| 方法 | 用途 |
|------|------|
| **`mountWorkbench(state, handlers)`** | 发布纯数据：tabs / 搜索 / 列表或 Gallery / 结构化详情 / Actions / Island |
| `itemsFromJson(value)` | 数组或对象 → 列表项 `{ title, subtitle, badge, raw }` |

条目可选字段（**business 模组**用这些即可，不必自绘）：

| 字段 | 说明 |
|------|------|
| `icon` | 行首短标记（emoji 等） |
| `image` | Gallery 图片 `{ url, alt?, fit? }`；只接受 HTTPS / data image |
| `badge` / `meta` | 右侧状态徽标 |
| `tone` | `success` / `danger` / `warning` / `accent` / `run` |
| `progress` | `0–100`，行内进度条（CI / 下载） |
| `detail` | `{ title, subtitle, body, fields, sections }`；由 Qx React 渲染，禁止 HTML |
| `actions` | 条目动作；可用 `command` 映射 manifest command，或交给 `onAction` |
| `raw` | 业务对象，供 `onSelect` / 详情映射 |

**指针与键盘（宿主 workbench 内置）**：List / Gallery 默认占满 Main Area；点击带详情的条目时宿主会立即显示新选中态，并切换为左侧保留当前集合、右侧打开详情，再异步调用插件 `onSelect`。List 由 `↑` / `↓` 线性移动；Gallery 由 `←` / `→` 同行移动、`↑` / `↓` 按当前响应式列数跨行移动。焦点在过滤框时，上下键继续浏览集合；Gallery 空查询的左右键也浏览网格，有查询文字时才保留左右光标。两种布局都支持 `PageUp` / `PageDown`、`Home` / `End`；Enter 对带详情条目先打开详情，无详情时才执行 Primary。Esc 先关闭详情并恢复全宽集合。即使发布 Workbench 的隐藏 iframe 暂时保留焦点，宿主也会接管集合导航键。业务插件仍应在 `onSelect` 里更新 `selectedId` 再 `mountWorkbench`；**不要**自己绑全局方向键或复制 split view。

**受控状态契约**：`query`、tabs 的 `active`、`selectedId` 由插件业务状态最终确认，但宿主会先即时呈现用户输入/点击。`onQuery`、`onTab`、`onSelect` 必须同步修改本地 state 并调用一次 `paint()`；不要先 `await` 网络或 CLI。慢加载应在回画之后 debounce/cancel，并用 generation 防止旧查询覆盖新结果。条目 `id` 与 action `id` 在当前发布中必须稳定且唯一。

动作事件带有用户触发时的 `selectedId` 快照，宿主 UI kit 会据此把正确的 `selectedItem` 传给 `onAction(id, selectedItem)`；即便选择回画还在排队，快速“点击条目 → Enter”也不会作用到上一条。插件不要自行缓存另一份“Actions 当前项”。

Qx 会渲染明暗主题、列表/详情、选择滚动、顶栏搜索/tabs、底栏主动作、右侧 Actions 和 Cmd/Ctrl+K。`state.island` 使用与 `context.island` 相同的数据形状；声明 `island` 权限后，同一份数据会按用户设置停靠或浮出。Workbench 不提供 iframe DOM/HTML 模式；复杂自绘界面应明确使用 custom panel。

```ts
type WorkbenchState = {
  layout?: { kind: "list" | "gallery"; columns?: number; aspectRatio?: "landscape" | "square" | "portrait" }
  tabs?: { id: string; label: string; active?: boolean }[]
  query?: string
  items: {
    id: string; title: string; subtitle?: string; badge?: string
    image?: { url: string; alt?: string; fit?: "cover" | "contain" }
    progress?: number; tone?: "neutral" | "success" | "warning" | "danger" | "accent"
    detail?: { title?: string; subtitle?: string; body?: string; fields?: { label: string; value: string | number | boolean | null }[]; sections?: object[] }
    actions?: { id: string; label: string; command?: string; primary?: boolean; kbd?: string }[]
  }[]
  actions?: { id: string; label: string; command?: string; primary?: boolean; tone?: string }[]
  island?: {
    primary: string; secondary?: string; progress?: number; tone?: string
    countdown?: { endsAt?: number; remainingMs?: number; durationMs?: number; paused?: boolean }
    action?: { label: string; command: string; icon?: "pause" | "play" | "stop" | "open"; variant?: "default" | "danger" }
  } | null
  backgroundPoll?: { command: string }
}
```

`command` 只能引用当前插件 manifest 中声明的命令，宿主会校验后在长期存活的 command runtime 执行；不写 `command` 时，事件回到当前 panel 的 `handlers.onAction(id, selectedItem)`。

`backgroundPoll.command` 必须引用当前插件 manifest 中 `mode: "no-view"` 且带 `interval` 的命令。该命令由宿主在 Workbench 关闭后继续调度，并把结果写入 `context.storage.persist`；Workbench 打开时先读取持久化快照，后台命令完成后再通过 `handlers.onBackgroundPoll(event)` 重载。不要把需要持续存在的计时器或轮询器放在 `panel.render`。

Workbench action 引用普通 manifest command 时，命令完成后宿主调用 `handlers.onCommandComplete({ command, at })`。使用它立即重读持久化状态；不要用亚秒级 `storage.persist.get` 轮询等待暂停、继续或删除等动作完成。

```js
context.ui.mountWorkbench({
  items,
  backgroundPoll: { command: "background-refresh" },
}, {
  onCommandComplete: () => void loadPersistedSnapshot(),
  onBackgroundPoll: () => void loadPersistedSnapshot(),
});
```

### 最小 Panel 骨架（必读：render 要快返回）

```js
export default {
  panel: {
    render(container, context) {
      const state = { tab: "list", items: [], loading: true, dead: false, selectedId: null };

      const paint = () => {
        if (state.dead) return;
        context.ui.mountWorkbench({
          title: "My CLI",
          loading: state.loading,
          error: state.error,
          items: state.items.map((item) => ({
            ...item,
            detail: {
              title: item.title,
              fields: Object.entries(item.raw || {}).map(([label, value]) => ({ label, value })),
            },
            actions: [{ id: "inspect", label: "Inspect", primary: true }],
          })),
          selectedId: state.selectedId,
          actions: [{ id: "reload", label: "Reload", primary: true }],
          island: state.loading
            ? { primary: "My CLI", secondary: "Refreshing", tone: "neutral" }
            : null,
        }, {
          onAction: (id, item) => {
            if (id === "reload") void load();
            if (id === "inspect") context.showToast(item?.title || "Selected");
          },
          onSelect: (id, item) => {
            state.selectedId = id;
            paint();
          },
        });
      };

      const load = async () => {
        state.loading = true;
        state.error = null;
        paint();
        try {
          const data = await context.cli.json({
            program: "my-cli",
            args: ["list", "--json"],
          });
          state.items = context.ui.itemsFromJson(data);
        } catch (e) {
          state.error = String(e.message || e);
          state.items = [];
        } finally {
          state.loading = false;
          paint();
        }
      };

      paint();
      void load(); // 不要 await —— 避免 renderPanel timeout
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
```

---

## 4. 推荐产品模式

| 模式 | 适合 | 数据路径 |
|------|------|----------|
| **A. 状态列表** | brew outdated、发布任务、pod 列表 | `json` → `itemsFromJson` → 行操作 `ensure` |
| **B. 只读巡检** | `uname`、磁盘、版本 | `text` / `lines` + 详情 |
| **C. 危险动作** | upgrade / delete / redeploy | `prompt` 确认 → `ensure` → Reload |
| **D. 混合日志** | 工具又打 log 又打 JSON | `parseJson` 宽松解析 或 `jsonl` |

危险操作：

```js
const ok = await context.prompt(`Upgrade ${name}? Type YES`, "");
if (ok !== "YES") return;
await context.cli.ensure({ program: "brew", args: ["upgrade", name] });
```

---

## 5. 示例插件 `cli-workbench`

路径：[`public/plugins/cli-workbench`](../plugins/cli-workbench)

| Tab | 展示 |
|-----|------|
| JSON demo | `cli.json` 通过 argv 进程产出对象数组 → 列表 + KV/JSON 详情 |
| JSONL | `cli.json({ jsonl: true })` 解析多行 JSON |
| Lines | `cli.lines` 解析纯文本行 |
| System | `which` + `text` 看 PATH 是否找得到 PowerShell/bash/brew/node |
| Custom | 读 preferences 里的 program/args；留空时按 Windows / POSIX 选择平台默认命令，自动尝试 JSON 否则按行 |

命令：

- **Demo: CLI JSON toast** — 无界面，验证跨平台 `cli.json` argv 链路
- **CLI Workbench** — 引导打开 panel

示例本身不要求 Bash：Windows 使用 PATH 中的 PowerShell，macOS/Linux 使用
`printf`。`jsonBash` 仍适合明确依赖 Git Bash 或 POSIX shell 的插件，但不应成为
声明 Windows 支持的入门示例的必需条件。

本地试跑：把目录拷到 `~/.qx/plugins/cli-workbench/` 或 zip 后 **Import**。

---

## 6. 从「一条命令」到插件的检查单

1. 工具能否 **`--json` / 稳定 stdout**？（没有就用 `lines` 或包一层 `bash`）
2. manifest：`permissions: ["cli", "notifications"]`，必要时 `clipboard`
3. preferences：可配置 **绝对路径**（GUI PATH 仍可能缺专有工具）
4. panel：`render` 只画壳，`void load()`
5. 列表项字段约定：`name`/`title`/`id`/`desc`/`version`/`kind` → `itemsFromJson` 自动映射
6. 写操作：`prompt` + `ensure` + 刷新
7. `min_app_version` ≥ 含 workbench 的宿主版本

---

## 7. 市场插件参考

- **brew**：CLI 数据源，使用宿主 Workbench List + Detail 呈现
- **sysinfo**：`context.system.*` typed 数据源，复用 Overview / Storage / Network /
  Processes tabs、List / Detail 与确认式 Actions；证明 Workbench 不依赖 CLI
- **cli-workbench**：教学向，演示 argv / JSON / JSONL / Lines 与宿主 UI kit
- 新业务插件建议：**数据源走最窄的 `context.*` 端口，UI 用
  `ui.mountWorkbench`，业务状态由插件持有**

复杂图表、地图、画布等确有自定义布局需求时仍可使用 custom panel；标准列表、
Gallery、详情和 Actions 应优先复用 Workbench，避免重复实现 shell、焦点和跨平台样式。
