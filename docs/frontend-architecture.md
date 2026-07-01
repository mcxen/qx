# 前端子系统总览

Qx 前端是 React 19 + Zustand + Tauri v2 API + shadcn 组件。入口 `src/main.tsx` → `App.tsx`。本文件描述各子系统的边界与关键文件；组件视觉规范另见 [UI_SPEC.md](../UI_SPEC.md)、[docs/settings-panel.md](./settings-panel.md)。

## 目录结构

```
src/
├─ App.tsx                # 顶层 shell、tab 切换、IPC 事件监听、doSearch orchestration
├─ Launcher.tsx           # launcher shell（顶栏 + 结果 + 底部灵动岛）
├─ SearchBar.tsx          # 顶部搜索框，controlled input
├─ ResultsList.tsx        # 结果列表（含 loading skeleton）
├─ ThemeProvider.tsx      # data-theme + .dark 同步
├─ store.ts               # 全局 Zustand store：query、results、selectedIndex、loadingPhase、appsReady
├─ i18n.ts                # useT + 键平铺字典
├─ components/            # 通用组件（ui.tsx 是 shadcn re-export）
├─ launcher/              # launcher 私有子系统
│  ├─ LauncherContext.tsx # 右侧 context aside（Quick Entries、最近启动、最近搜索、alias tag 编辑）
│  ├─ QuickEntryIcons.tsx # 顶栏右侧 quick entry 图标按钮（v0.4.42）
│  ├─ launcherActions.ts  # 结果项的 Actions Menu 内容
│  ├─ useLauncherHistory.ts # 拉最近历史，去重后暴露给 context
│  ├─ quickEntries.ts     # QUICK_ENTRY_TARGETS 静态表 + sanitize + toLauncherQuickEntries
│  └─ types.ts
├─ search/
│  ├─ appDisplay.ts       # display_name / pinyin 显示 hook
│  ├─ searchMetadata.ts   # alias / tag 存储（每个 app path 一份）
│  └─ calculator.ts       # ":=" 前缀触发的即时计算
├─ modules/               # 各功能面板；每个子目录是一个可懒加载模块
│  ├─ clipboard/  qx-ai/  rss/  screencap/  macros/  v2ex/
│  │  weather/  documents/  github-calendar/  settings/
├─ plugin/                # 插件运行时（见 docs/plugin-architecture.md）
├─ hooks/                 # useEscBack、usePanelKeyWindow
├─ utils/                 # keyboard、sanitize-html
└─ styles/                # 全部 CSS；base.css 是 token；shell.css、select.css 是核心
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

`Launcher.tsx:69-94` 将 `loadingPhase` + `isSearching` + `pluginIsland` + `results.length` 综合为一个 `BottomIslandContent`：

- `loading-apps` → "Loading apps..." + bounce
- 搜索中 → "Searching" + query + bounce + 3 点脉冲（v0.4.42）
- 插件 status → 插件自己 emit 的 `pluginIsland`
- 有结果 → "Search ready" + count + progress bar
- 空态 + 用户选了 date/system island 模式 → 显示 `HomeDateIsland` / `HomeSystemIsland`
- 其它空态 → "Qx Launcher / Type to search"

`QxBottomIsland` 组件里 `activity` 只是给 label 加 pulse + 显示 curve/dots。progress 则完全独立的 2px 条。

## i18n

`src/i18n.ts` 是一个平铺 key → { zh, en } 字典。用法：

```tsx
const t = useT();
<h1>{t("launcher.title", "Qx Launcher")}</h1>;
```

第二个参数是英文 fallback，永远存在。语言由 `useSettingsStore().settings.language` 控制（`"zh" | "en" | "system"`）。

## 键盘协议

Esc 处理有严格优先级，见 [AGENTS.md](../AGENTS.md) 的 Esc protocol 一节；`hooks/useEscBack.ts` 是唯一入口。

- 弹窗打开 → 关弹窗
- 输入框有值 → 清空
- 在 module tab → 回 launcher
- 在 launcher → hide panel（Rust `floating_hide_restore_focus`）

`Cmd+K` 打开 Actions Menu（`QxShell` 内部 handle）。

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
- `qx-bottom-island` / `qx-bottom-island-label` / `.is-activity-exiting`
- `qx-shadcn-<component>` — 是从 shadcn primitives 映射来的样式，比如 `qx-shadcn-input`

设计 token 全部在 `base.css`：`--qx-accent`、`--qx-border-1`、`--qx-bg-component-1/2/3`、`--qx-text-primary/secondary/tertiary`、`--qx-radius`、`--qx-card-radius`、`--qx-shell-*-opacity-effective` 等。改颜色/间距一定要用 token，别硬编码 hex。

## 与 Rust 的边界

- 前端只调 `@tauri-apps/api/core.invoke("cmd_name", { args })`。
- 事件 `@tauri-apps/api/event.listen("event_name", (e) => ...)`。
- 文件资源要通过 `convertFileSrc(path)` 转成 asset://；直接用 `file://` 会被 Tauri 拒。
- Window 操作用 `@tauri-apps/api/window.getCurrentWindow()`；hide/show/focus。

命令目录见 [docs/ipc-catalogue.md](./ipc-catalogue.md)。

## 添加新 module 的推荐流程

1. `src/modules/<name>/` 建目录，至少：`store.ts`、`<Name>Panel.tsx`
2. `store.ts` 用 zustand `create` 独立管理该模块状态
3. Panel 用 `<QxShell>` 包裹，接入底部灵动岛
4. `App.tsx` 加入 `React.lazy` 引用和 tab 分支
5. 若需要托盘 quick entry，`src/launcher/quickEntries.ts::QUICK_ENTRY_TARGETS` 加一行
6. i18n key 补全 zh/en
7. 更新 [`docs/technical-architecture.md`](./technical-architecture.md) 的 module 清单
