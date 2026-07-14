# 前端子系统总览

> 状态：Current · 适用版本：v0.5.8 · Owner：Frontend · 最后复核：2026-07-14

Qx 前端是 React 19 + Zustand + Tauri v2 API + shadcn 组件。入口 `src/main.tsx` → `App.tsx`。本文件描述各子系统的边界与关键文件；组件视觉规范另见 [UI_SPEC.md](../UI_SPEC.md)、[docs/settings-panel.md](./settings-panel.md)。

## 目录结构

```
src/
├─ App.tsx                # 顶层 shell、tab 切换、IPC 事件监听、doSearch orchestration
├─ Launcher.tsx           # launcher shell；空闲 island 只调 home-island.resolve
├─ SearchBar.tsx          # 顶部搜索框，controlled input
├─ ResultsList.tsx        # 结果列表（含 loading skeleton）
├─ ThemeProvider.tsx      # data-theme + .dark 同步；theme=system 跟 OS
├─ store.ts               # 全局 Zustand store：query、results、selectedIndex、loadingPhase、appsReady
├─ i18n.ts                # useT / useLocale / system 语言解析
├─ home-island/           # Launcher 空闲灵动岛（注册表 + 异步数据总线）
│  ├─ registry.ts / catalog.ts / resolve.ts
│  ├─ HomeIslandSettings.tsx
│  ├─ data/bus.ts + hooks.ts   # 非阻塞 metrics
│  └─ modes/              # 各模式 UI + Definition
├─ components/            # 通用组件（ui.tsx 是 shadcn re-export）
├─ launcher/              # launcher 私有子系统
│  ├─ LauncherContext.tsx # 右侧 context aside
│  ├─ launcherActions.ts  # 结果项的 Actions Menu 内容
│  ├─ useLauncherHistory.ts
│  ├─ quickEntries.ts
│  └─ types.ts
├─ search/
│  ├─ appDisplay.ts       # display_name hook（跟 useLocale）
│  ├─ searchMetadata.ts
│  ├─ moduleSurfaces.ts   # 主搜索动态深链（RSS feed 等），见 docs/module-surfaces.md
│  └─ calculator.ts
├─ modules/               # 可懒加载功能面板
├─ plugin/                # 插件运行时（见 docs/plugin-architecture.md）
├─ hooks/                 # useEscBack、usePanelKeyWindow
├─ utils/                 # keyboard、sanitize-html
└─ styles/                # base.css token；shell.css chrome
```

## 状态管理

Zustand 单 store（`store.ts`）保存 launcher 强共享状态：

- `query`、`setQuery`
- `results: AppEntry[]`、`setResults`
- `selectedIndex`、`setSelectedIndex`
- `loadingPhase: "loading-apps" | "ready" | "loading-background"`
- `appsReady: boolean`

每个 module 有自己的 zustand store（`modules/<module>/store.ts`），互不共享。Settings store 在 `modules/settings/store.ts`，通过 `useSettingsStore()` 全局访问；写入即刻 debounce 5s 后 `invoke("update_settings")`。

## Tab 路由

由 `App.tsx` 管理，值域包括：`launcher | clipboard | qx-ai | rss | screencap | v2ex | weather | macros | documents | settings | plugin:<id>`。

切换方式：
- 用户点 quick entry / Actions menu → 调 `onNavigate(tab)`
- 全局 DOM 事件 `qx:navigate` → `App.tsx` 监听（托盘菜单 Rust 端 emit 后前端触发）
- URL hash 不使用（Tauri 不走浏览器 history）

每个 module 面板通过 `React.lazy` 异步加载，加载中显示 `ModuleLoadingShell` skeleton。

## 搜索管线

`App.tsx.doSearch()` 是核心。流程：

1. `setIsSearching(true)`；`searchSeqRef` 自增，用于丢弃过期结果
2. 若 query 空 → `useLauncherHistory` 提供最近启动/搜索作为空态填充，直接 return
3. 100ms debounce 后开始
4. 并发发出：
   - `invoke("search_apps", { query })` — 主要
   - Plugin registry `findCommands(query)` — 内置命令 + 插件命令，同步打分
   - Calculator 前缀 `:=` 或数学表达式检测 → 立即塞一个结果
5. 260ms 后二次 debounce 触发 `search_files`（Spotlight）和 `get_clipboard_history` 过滤
6. 结果合并 → `startSearchTransition(() => setResults(merged))`
7. 900ms 后 `record_search(query)`
8. `finishSearchActivity()` 关 `isSearching` → 180ms 后关 `isSearchSettling`（用于底部灵动岛的收尾动画）

所有 async 回调都用 `if (seq !== searchSeqRef.current) return` 保护过期。

## Loading 与灵动岛

### 任务态 shell island

`Launcher.tsx` 按优先级合成 `BottomIslandContent`（QxShell `island` prop）：

1. `loading-apps` → Loading apps + bounce
2. 搜索中 / settling → Searching + query + bounce
3. `pluginIsland` → 插件 status
4. 有结果 → Search ready + count
5. **空闲** → `resolveHomeIsland(...).shellContent`（仅 `kind: "shell"` 模式，如 default）

空闲且模式为 `custom` 时，用 `customIsland={resolveHomeIsland(...).customNode}`。

`QxBottomIsland`：`activity` 控制 pulse / curve；`progress` 是独立 2px 条。

### Home Island 模块（`src/home-island/`）

可插拔空闲 HUD。Launcher / Appearance **不得**硬编码模式列表。

| API | 用途 |
|---|---|
| `registerHomeIsland(def)` | 注册模式 |
| `listHomeIslands()` | 设置卡片 |
| `normalizeHomeIslandMode(id)` | 未知 id → 默认 |
| `resolveHomeIsland(appearance, t)` | idle 渲染决策 |
| `HomeIslandSettings` | 外观页卡片 + 可选 Settings 行 |

`HomeIslandDefinition`：`id`、`order`、文案 key、`preview`、`kind: "shell" | "custom"`、`Component?`、`Settings?`。

内置：`default` · `system` · `date` · `pulse` · `core` · `orbit`。扩展步骤见 `src/home-island/README.md`。

### 异步数据总线（强制非阻塞）

路径：`src/home-island/data/bus.ts`。

```text
modes ──useIsland*──► bus（interest + cache）
                         │
            requestIdleCallback / interval
                         │
              invoke → Rust spawn_blocking
```

规则：

- **禁止**在组件 render 中同步等待 IPC。
- 首屏占位 `--`；数据到达后再更新。
- 首次采样 idle 调度；`document.hidden` 暂停。
- channel 兴趣计数 + in-flight 去重；`stats` 由 System/Orbit 共享。
- Hooks：`useIslandStats` / `useIslandPower` / `useIslandNet` / `useIslandData`。
- 样式 token：`--qx-system-island-*`、`--qx-stats-*`（跟主题 Light/Dark/System）。

Rust 侧：`get_system_stats`、`qx_system_monitor_network_counters`、`qx_system_monitor_power` 均 `spawn_blocking`，不堵 async runtime。

## i18n

`src/i18n.ts`：

- `useT(key, englishFallback)` — zh 表覆盖，en 用 fallback
- `useLocale()` — **已解析** `"en" | "zh-CN"`
- `useLanguagePreference()` — 设置原值 `"system" | "en" | "zh-CN"`
- `resolveLocale` / `detectSystemLocale` — system 仅简体中文 → zh-CN，其余 en

快捷键 `kbd` / `formatQxShortcut` **不**经 `t()`。应用显示名用 `useDisplayName()`（zh-CN 优先 `display_name`）。

## 主题

`ThemeProvider`：`light | dark | system`。`system` 监听 `prefers-color-scheme`，同步 `data-theme` + `.dark`。灵动岛与 Shell 只用 CSS 变量，自动跟主题。

## 键盘协议

Esc 处理见 [AGENTS.md](../AGENTS.md) / [UI_SPEC.md](../UI_SPEC.md)；`hooks/useEscBack.ts` + QxShell `escapeAction`。

- 弹窗 / Actions 菜单优先
- 模块 `useEscBack` 级联
- Shell 兜底触发 `escapeAction.onClick`
- Launcher 根视图无离开模块的 Esc；hide 走 Rust floating

`Cmd/Ctrl+K` 仅当前 Shell 事件链。`data-qx-region` 区域导航。

## Plugin Runtime（简述）

见 [docs/plugin-architecture.md](./plugin-architecture.md)。核心：

- `plugin/registry.ts` — zustand store：list/load/unload、shortcut 注册、command scoring
- `plugin/runtime.ts` — iframe 沙箱 + Blob URL + postMessage RPC dispatch
- `plugin/rpcMethods.ts` — RPC method 表 + 权限检查
- `plugin/context.ts` — 生成插件可见的 context 对象（能力 vs unavailable）
- `plugin/aiRuntime.ts` — AI task 状态机

## 样式

`src/styles/` 下的 CSS 都是全局的（没有 CSS Modules）。命名规则 `qx-<component>-<part>-<state>`：

- `qx-shell` / `qx-shell-topbar` / `qx-shell-bottombar`
- `qx-bottom-island` / `qx-home-system-island` / `qx-home-sci-island`
- `qx-shadcn-<component>`

Chrome 尺寸（上下栏厚度接近）：

```css
--qx-shell-chrome-x: 14px;
--qx-topbar-h: clamp(48px, 6vh, 54px);
--qx-bottom-bar-h: clamp(46px, 5.8vh, 54px);
```

Top / Bottom 水平 inset 必须共用 `--qx-shell-chrome-x`。Topbar 内搜索约 36px 高。

设计 token 在 `base.css`：`--qx-accent`、`--qx-border-*`、`--qx-bg-component-*`、`--qx-text-*`、`--qx-system-island-*`、`--qx-stats-*` 等。改颜色/间距用 token，禁止硬编码 hex。

## 与 Rust 的边界

- 前端只调 `@tauri-apps/api/core.invoke("cmd_name", { args })`。
- 事件 `@tauri-apps/api/event.listen("event_name", (e) => ...)`。
- 文件资源要通过 `convertFileSrc(path)` 转成 asset://；直接用 `file://` 会被 Tauri 拒。
- Window 操作用 `@tauri-apps/api/window.getCurrentWindow()`；hide/show/focus。

命令目录见 [docs/ipc-catalogue.md](./ipc-catalogue.md)。

## 添加新 module 的推荐流程

1. `src/modules/<name>/` 建目录，至少：`store.ts`、`<Name>Panel.tsx`
2. `store.ts` 用 zustand `create` 独立管理该模块状态
3. Panel 用 `<QxShell>` + `escapeAction` + `useEscBack`；文案走 `useT`
4. `App.tsx` 加入 `React.lazy` 引用和 tab 分支
5. 若需要 quick entry，`quickEntries.ts` + i18n
6. 更新 technical-architecture module 清单

## 添加 Home Island 模式

1. `src/home-island/modes/FooIsland.tsx` + `fooMode.tsx`
2. `catalog.ts` → `registerHomeIsland(fooHomeIsland)`
3. 需要系统指标时用 `useIsland*` 或扩展 `data/bus.ts` channel（禁止组件内阻塞轮询）
4. i18n title/hint keys
5. 详见 `src/home-island/README.md` 与 [UI_SPEC.md](../UI_SPEC.md) Home Island 节
