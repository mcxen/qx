# CLI → GUI：把命令行产品化成 Qx 插件

> 配套：[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)（spawn 协议）·
> [`plugin-development-guide.md`](./plugin-development-guide.md)（作者手册）·
> 示例插件：`public/plugins/cli-workbench`

目标：用户在 Terminal 里用的工具（`brew`、`kubectl`、内部 release-cli、`jq` 管道…）在 Qx 里变成 **可搜索、可点选、可确认** 的界面，而不是再开黑窗。

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
│  CLI 解析层：JSON / 行 / 失败即抛              │  宿主注入
└──────────────────────┬──────────────────────┘
                       │ context.cli.run / bash / which
┌──────────────────────▼──────────────────────┐
│  进程层：login PATH · timeout · argv/bash     │  Rust
└─────────────────────────────────────────────┘
```

| 层 | 职责 | 不要做 |
|----|------|--------|
| **进程** | 找到二进制、跑起来、超时 | 在插件里猜 OS 路径 |
| **解析** | stdout → JSON / 行 / 文本，统一错误 | 到处 `JSON.parse` + 手写 exit 检查 |
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

无额外权限。样式使用 Qx CSS 变量（`--qx-text-primary`、`--qx-accent`…）。

| 方法 | 用途 |
|------|------|
| `esc(value)` | HTML 转义 |
| `styles.workbench` | 工作台 CSS 字符串（可自挂） |
| **`mountWorkbench(container, state, handlers)`** | 一键：标题 / tabs / 搜索 / 工具栏 / 列表 / 详情 |
| `itemsFromJson(value)` | 数组或对象 → 列表项 `{ title, subtitle, badge, raw }` |
| `renderJson(value)` | 详情区 pretty JSON |
| `renderKeyValue(record)` | 详情区键值表 |

列表项可选字段（**business 模组**用这些即可，不必自绘）：

| 字段 | 说明 |
|------|------|
| `icon` | 行首短标记（emoji 等） |
| `badge` / `meta` | 右侧状态徽标 |
| `tone` | `success` / `danger` / `warning` / `accent` / `run` |
| `progress` | `0–100`，行内进度条（CI / 下载） |
| `raw` | 业务对象，供 `onSelect` / 详情映射 |

### 最小 Panel 骨架（必读：render 要快返回）

```js
export default {
  panel: {
    render(container, context) {
      const state = { tab: "list", items: [], loading: true, dead: false };

      const paint = () => {
        if (state.dead) return;
        context.ui.mountWorkbench(container, {
          title: "My CLI",
          loading: state.loading,
          error: state.error,
          items: state.items,
          selectedId: state.selectedId,
          detailHtml: state.detailHtml,
          toolbar: [{ id: "reload", label: "Reload", primary: true }],
        }, {
          onToolbar: (id) => { if (id === "reload") void load(); },
          onSelect: (id, item) => {
            state.selectedId = id;
            state.detailHtml = context.ui.renderJson(item.raw);
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
| JSON demo | `jsonBash` 产出对象数组 → 列表 + KV/JSON 详情 |
| JSONL | 多行 JSON → 列表 |
| Lines | 纯文本行 |
| System | `which` + `text` 看 PATH 是否找得到 brew/node |
| Custom | 读 preferences 里的 program/args，自动尝试 JSON 否则按行 |

命令：

- **Demo: CLI JSON toast** — 无界面，验证 `jsonBash` 链路
- **CLI Workbench** — 引导打开 panel

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

## 7. 与 Brew 市场插件的关系

- **brew**：完整业务（install/upgrade/search），自绘 CSS
- **cli-workbench**：教学向，演示 **宿主 kit** 如何少写样板
- 新业务插件建议：**解析用 `cli.json/ensure`，UI 用 `ui.mountWorkbench`，业务状态自己管**

市场级复杂插件仍可自绘；kit 保证「十分钟可跑通」的下限体验一致。
