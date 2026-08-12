# CLI Workbench：把结构化命令产品化成 Qx 插件

这份文档只描述“CLI 数据如何进入 Workbench”的组织模式。`context.cli` 字段与安全语义见
[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)，Workbench 与 Actions 见
[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)。

## 1. 分层

```text
CLI adapter
  argv / stdout / stderr / exit
        ↓
domain parser
  stable items / status / errors
        ↓
workflow
  cache / refresh / task progress
        ↓
Workbench
  list / detail / filters / actions / island
```

- CLI adapter 只负责执行与规范化返回值。
- Parser 是纯函数，可用固定样本测试。
- Workflow 决定缓存、取消、并发和真实进度。
- Workbench 不解析任意终端颜色或布局。

## 2. 选择输出格式

优先级：

1. CLI 原生 JSON；
2. CLI 的稳定机器可读格式；
3. 自己控制的分隔行；
4. 最后才解析面向人的文本。

```js
const result = await context.cli.run({
  program: "tool",
  args: ["list", "--json"],
  timeoutMs: 20_000,
});

if (!result.ok) {
  throw new Error(result.stderr || `tool exited ${result.code}`);
}

const rows = context.cli.parseJson(result.stdout);
```

Parser 输出稳定业务模型，不直接把 CLI 原始字段泄漏到 UI：

```js
function toItems(rows) {
  return rows.map((row) => ({
    id: String(row.id),
    title: row.name || "(untitled)",
    subtitle: row.description || "",
    accessories: [{ text: row.status }],
  }));
}
```

## 3. Panel 快返回

不要在 `panel.render()` 中等待慢命令：

```js
let workbench;
let revision = 0;

function render(context) {
  // Qx automatically restores the last successful Workbench presentation.
  workbench = context.ui.mountWorkbench(buildWorkbench([], { refreshing: true }));
}

async function refresh(context) {
  const task = await context.cli.start({
    program: "tool",
    args: ["list", "--json"],
  });
  await context.island.show({
    id: "tool-refresh",
    label: "Refreshing",
    indeterminate: true,
  });
  const result = await context.cli.wait(task.id);
  if (!result.ok) throw new Error(result.stderr);
  const items = toItems(context.cli.parseJson(result.stdout));
  workbench.updateItems({ revision: ++revision, upsert: items, order: items.map((item) => item.id) });
  workbench.update({ loading: false, error: null });
}
```

真实阶段可映射为进度；CLI 没有可计算进度时使用 indeterminate，不能模拟百分比。

## 4. 一个动作集合

```js
actions: [
  {
    id: "open",
    label: "Open",
    primary: true,
  },
  {
    id: "refresh",
    label: "Refresh",
    command: "refresh",
    kbd: "R",
  },
  {
    id: "copy-id",
    label: "Copy ID",
    kbd: "CommandOrControl+C",
  },
]
```

同一动作同时出现在 Bottom Bar、Enter、Actions 与 Context Panel。不要再维护另一份 CLI
快捷键分支或自绘按钮。CLI 任务状态只改变动作的 `disabled`、标签或状态，不改变稳定 ID。

## 5. 错误与恢复

把错误分成：

- executable unavailable：显示安装或 PATH 提示；
- permission denied：指出需要的插件权限；
- timeout/cancelled：保留缓存并允许重试；
- non-zero exit：展示短错误，详细 stderr 进日志或详情；
- parse error：保留原始输出摘要，避免把空数组伪装成成功。

任何失败都不应清空仍可安全使用的缓存。Workbench 呈现快照由宿主统一缓存；只有 CLI 游标、
原始输出或离线业务数据需要插件自行写 `context.storage.persist`。

## 6. 并发与刷新

- 单次刷新使用 task id，可取消旧任务。
- 多目标使用 `context.cli.map` 的有界并行，不为每项无限启动进程。
- 新查询到来时标记旧结果过期。
- 任务终态后再写持久缓存。
- 不在异步等待期间持有宿主锁。

## 7. 产品模式

### 状态看板

JSON 列表 → Workbench List；状态是 accessory；选择后 Detail 展示日志；Refresh 是命令。

### 发布工作台

列表展示项目与版本；Form 收集参数；启动长任务后 Island 报告真实阶段；完成后刷新缓存。

### 多环境检查

对环境集合执行 `cli.map`；每行独立状态和错误；总体进度来自完成数量。

### 命令入口

无持久 Panel 时使用 `mode: "no-view"`；完成后通过 toast 或 Island 给出短反馈。

## 8. 检查表

- [ ] 使用 argv API，只有确需 shell 语义时才用 bash。
- [ ] 解析机器可读输出，parser 可独立测试。
- [ ] Panel render 先返回缓存。
- [ ] 进度真实或 indeterminate。
- [ ] 任务可超时、取消并形成终态。
- [ ] 动作只有一份且 ID 稳定。
- [ ] stderr、退出码与解析失败不被吞掉。
- [ ] Windows/macOS PATH 与路径由宿主处理。

从零搭建插件见 [`plugin-development-guide.md`](./plugin-development-guide.md)。
