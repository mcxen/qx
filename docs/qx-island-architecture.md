# QxIsland 当前架构

> 状态：Current · 适用版本：v0.6.102 · Owner：Core · 最后复核：2026-08-31
>
> 本文只定义已实现的 Island 契约。早期提案、PR 分期和被否决方案见 [`archive/qx-island-design-history.md`](./archive/qx-island-design-history.md)。视觉、响应式与 Esc 规则以 [`UI_SPEC.md`](../UI_SPEC.md) 为准。

## 1. 职责与边界

QxIsland 是宿主拥有的状态与呈现端口。模块、Home provider、插件和系统任务发布可序列化 session；宿主选择唯一可见 winner，并用同一个 surface 渲染 docked 或显式浮出的窗口。

```text
module / home / plugin / shell / system
                  |
      islandHost show / update / dismiss
                  |
        single in-process session store
                  |
       priority + rotation selection
          |                       |
  QxIslandDockSlot        IslandFloatBridge
          |                       |
  QxIslandDockHost        IslandFloatApp
          \________ QxIslandSurface ________/
```

职责分配：

- `src/island/types.ts`：稳定数据类型；
- `src/island/session/`：session 生命周期、动作注册、优先级、TTL 和轮播；
- `src/island/surface/`：宿主 chrome、内容策略和 docked 渲染；
- `src/island/float/`：可选浮窗桥接，不建立第二份业务状态；
- `src/island/bridge/pluginIslandBridge.ts`：插件能力收口；
- `src/island/recents/`：最近界面切换器及唯一 Motion spring；
- `src/home-island/`：Home 的模式、数据总线和组件注册，不拥有另一套 Island store。

`QxBottomIsland` 只保留为旧类型适配器。新调用必须通过 `islandHost` 和 `QxIslandDockSlot`，不能再创建并行 store、队列或自绘浮窗。

## 2. Session 契约

`IslandSession` 的稳定身份是 `id + generation`。同一 id 再次 `show` 会获得新的、由宿主递增的 generation；异步更新可带 `expectedGeneration`，避免旧任务覆盖新会话。

核心字段：

| 字段 | 语义 |
|---|---|
| `priority` | `task`、`error`、`toast`、`location`、`home` |
| `source` | `module`、`home`、`plugin`、`plugin-display`、`shell`、`system` |
| `placement` | `docked`、`floating`、`docked-or-float` |
| `content` | 标题、副标题、真实进度或 activity、宿主动作、tone、可选已注册组件 |
| `ttlMs` | 到期自动 dismiss；未声明时由来源与优先级应用安全默认值 |
| `sticky` | 长期 location 候选，可参与公平轮播 |
| `rankEpoch` | 只在影响排序的 show / priority / placement / sticky 变化时提升 |
| `contentUpdatedAt` | 内容与 TTL 记账；进度刷新不应借此抢占排序 |
| `openTarget` | 浮窗“打开 Qx”的宿主路由目标，插件不能任意指定 |

内容必须可 JSON 序列化。动作回调存入进程内 `actionRegistry`，session 只引用稳定 action id。dismiss、TTL 到期或 session 被替换时，宿主负责解绑动作。

### 生命周期

```text
show(id) -> generation N -> update(id, expectedGeneration=N)* -> dismiss(id)
                         \-> TTL / safety timeout ------------/
```

- `show` 是一次新发布，不是内容 patch。
- 带 `primary` 的 `content` 更新视为完整快照，省略的可选状态会被清除，防止完成后残留 spinner 或 action。
- 高频进度使用 `progressSilent`；只更新内容，不改变排序。
- task 进度必须真实；无法计算时用 `meter.kind="activity"`，不能模拟百分比。

## 3. 可见项选择

严格优先级为：

```text
task > error > toast > location > home
```

同一优先级按 sticky 语义、`rankEpoch`、创建时间和 id 稳定排序。location 有额外规则：当前模块的非 sticky location 优先；只有后台 sticky location 时才按共享 rotation index 公平轮播。普通内容更新不会重置轮播或把自己推回首位。

`customIsland` 是少数宿主级例外（例如需要专用交互的捕获状态）：`QxIslandDockSlot` 暂时渲染 exception，并抑制 store winner；session 仍保留，例外退出后继续参与选择。模块不得把 `customIsland` 当作常规扩展口。

## 4. Producer 权限

| Producer | 允许的主要用途 | 宿主限制 |
|---|---|---|
| module / shell | 任务、错误、当前位置和短反馈 | task 默认有 safety TTL；退出时清理所属会话 |
| home | 空闲 Home 内容 | 只能在更高优先级没有 winner 时出现 |
| system | 宿主级状态 | 仍使用同一 session 与 action 契约 |
| plugin | 短 toast | 强制 `toast`、docked、非 sticky、无自定义组件，TTL 最长 8 秒 |
| plugin-display | 插件持久显示 | 强制 `location`、sticky、`docked-or-float`，open target 绑定当前插件 |

插件文本由宿主截断，进度钳制到 0–100；插件不能发布任意 React 组件、抢占 task/error、创建永驻 toast 或把浮窗导向其它模块。

## 5. Docked、Floating 与最近界面

`QxIslandDockSlot` 是 QxShell 的唯一 docked 入口：exception 优先，否则渲染 store winner，没有 winner 时保留 shell 空态。`.qx-shell-bottombar` 负责窗口相对居中，不允许模块自行计算偏移。

Floating 是同一 winner 的另一种宿主 surface：

- 只有 placement 允许且用户/宿主显式请求时才显示；Home 不自动浮出。
- `IslandFloatBridge` 将可序列化 snapshot 同步给独立窗口；浮窗不运行第二套 producer 或排序。
- 浮窗动作与“打开 Qx”继续由主进程宿主执行；失去主窗口连接时必须安全降级。
- 主窗与 Island 浮窗属于同一焦点组，窗口显隐规则见 [`shell-and-shortcuts.md`](./shell-and-shortcuts.md)。

双击 docked Island 可打开最多 5 个最近界面。开关和列表属于宿主 chrome；模块和插件不实现自己的最近项。Esc 先关闭该切换器，再进入模块 Esc 阶梯。动画只使用 `src/island/recents/recentMotion.ts` 中现有的 `framer-motion` spring。

## 6. 扩展规则

新增 Island 能力时：

1. 先判断它是内容字段、宿主动作，还是确实新的 placement/capability；不要为单个模块加私有 variant。
2. 在 `types.ts` 冻结窄且可序列化的契约，同时更新 docked、floating 和 unavailable/plugin 适配。
3. 宿主统一执行权限、长度、TTL、路由和动作校验；producer 只表达业务意图。
4. 在现有 store 修复排序或生命周期，迁移所有第一方 consumer；禁止在调用点复制优先级判断。
5. 高频生产者用缓存、节流和 silent progress；不得让 render、采样或网络请求阻塞输入。

## 7. 验证

相关门禁由 `npm run check` 汇总。修改 Island 时至少覆盖：

- session generation、TTL、完整快照更新和 action 清理；
- 严格优先级、location 轮播与 progress 不抢占；
- plugin / plugin-display caps；
- exception 抑制、docked 与 floating snapshot 一致性；
- 最近界面开关、Esc 优先级与 reduced motion；
- `npx tsc --noEmit` 和 `npm run build`。
