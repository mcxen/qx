# Plugin Tray 能力端口（`context.tray`）

> 给**插件作者**的宿主能力契约。  
> 宿主托盘实现见 `src-tauri/src/tray_menu.rs`；前端桥接 `App.tsx` + `rpcMethods.ts`。

## 心智模型

```text
插件代码                          宿主
────────                          ────
context.tray.setItems([...])  →  系统托盘菜单（仅本插件的行）
context.system.stats()        →  CPU / 内存（拼 title）
context.system.networkCounters() → 字节计数（插件自己算速率）
用户点击托盘项                 →  plugin-tray-action
                              →  运行本插件 commands[].name
```

插件**不**直接操作 OS 托盘 API；只依赖 Qx 端口。  
用户设置里的「托盘菜单」控制**宿主内置**项（打开窗口、内置 Memory/Net 状态行等）；**插件项与内置项并列显示**。

## 权限

| 权限 | 用途 |
|------|------|
| **`tray`** | `context.tray.*` |
| **`system-stats`** | `context.system.stats()`（CPU/内存） |
| **`system-info`** | `context.system.networkCounters()`（网卡累计字节） |

manifest 示例（实时内存 + 网速菜单）：

```json
{
  "permissions": ["tray", "system-stats", "system-info", "notifications"]
}
```

## API

### `context.tray.setItems(items)`

替换**本插件**全部托盘行（最多 **12**）。

```ts
type PluginTrayItem = {
  id: string;       // 稳定 id，≤48
  title: string;    // 菜单文案，≤64；可含实时数字
  enabled?: boolean;
  command?: string; // 点击时执行的本插件 commands[].name
};

await context.tray.setItems([
  { id: "mem", title: "MEM  12.4/32 GB  (39%)" },           // 纯状态，无 command
  { id: "net", title: "Net  ↓ 1.2 MB/s  ↑ 0.3 MB/s" },
  { id: "open", title: "Open Dashboard", command: "open" }, // 可点
]);
```

### `context.tray.clear()`

移除本插件全部托盘行。卸载 / 禁用插件时宿主也会清理。

### `context.tray.list()`

读回当前已注册项（调试或设置页）。

### 指标（拼 title 用）

```ts
const s = await context.system.stats();
// { cpu, memory /*%*/, memoryUsedGb, memoryTotalGb, gpu? }

const n = await context.system.networkCounters();
// { totalBytesIn, totalBytesOut, interfaces? }
// 两次采样做差 / Δt → 上下行速率
```

## 推荐：面板里后台刷新 title

```js
// panel.render — 首帧后 void 循环，勿阻塞 render 返回
let lastNet = null;
async function tick(context) {
  const s = await context.system.stats();
  const n = await context.system.networkCounters();
  let down = 0, up = 0;
  const now = Date.now();
  if (lastNet) {
    const sec = Math.max(0.001, (now - lastNet.t) / 1000);
    down = Math.max(0, (n.totalBytesIn - lastNet.in) / sec);
    up = Math.max(0, (n.totalBytesOut - lastNet.out) / sec);
  }
  lastNet = { t: now, in: n.totalBytesIn, out: n.totalBytesOut };
  const fmt = (b) =>
    b < 1024 ? `${b.toFixed(0)} B/s`
    : b < 1048576 ? `${(b / 1024).toFixed(1)} KB/s`
    : `${(b / 1048576).toFixed(2)} MB/s`;
  await context.tray.setItems([
    {
      id: "mem",
      title: `MEM  ${s.memoryUsedGb.toFixed(1)}/${s.memoryTotalGb.toFixed(0)} GB  (${s.memory.toFixed(0)}%)`,
    },
    { id: "net", title: `Net  ↓ ${fmt(down)}  ↑ ${fmt(up)}` },
    { id: "open", title: "Open", command: "open" },
  ]);
}

// 在 panel.render 里：
// void (async () => { for (;;) { await tick(context); await sleep(3000); } })();
// destroy 时设 dead 标志停循环
```

## 点击语义

| 项 | 行为 |
|----|------|
| 无 `command` | 可显示；点击无插件逻辑（状态行） |
| 有 `command` | 宿主 `runCommand(pluginId, command)` |
| 插件未加载 / 无该 command | 记日志，不崩溃 |

## 后端命令

| Tauri | RPC |
|-------|-----|
| `plugin_tray_set_items` | `traySetItems` |
| `plugin_tray_clear` | `trayClear` |
| `plugin_tray_list` | `trayList` |
| `get_system_stats` | `invoke` + `system-stats` |
| `qx_system_monitor_network_counters` | `invoke` + `system-info` |

## 与宿主内置状态行的关系

设置 → **高级 → 托盘菜单** 里的 `Status · Memory / Network / CPU` 是**宿主内置**实现，不占插件配额。  
插件用 `context.tray` 做**自己的**状态/入口；两者可同时出现。

## 约束

- 每插件最多 12 项；title/id 长度截断  
- 不要高频 `setItems`（建议 ≥2–3s）；托盘重建有成本  
- 禁用/卸载必须清托盘（宿主已做；插件 `destroy` 仍应 `clear`）  
- 不提供任意 NSStatusItem / 托盘图标替换（v1 仅共享 Qx 图标菜单）

## 版本

| 能力 | 建议 `min_app_version` |
|------|------------------------|
| `context.tray` + 内置 status 行 | 合入本端口的版本起 |
