# Built-in modules & marketplace plugins — port inventory

> 状态：Current · 适用版本：v0.5.36+ · Owner：Core · 最后复核：2026-07-17
> 目的：一次看清**可复用抽象**落在哪些模块、还有哪些缝。写新插件/新内置时先读这份 + 作者手册。

相关：

- 宿主模块 shell：`src/hooks/useQxModuleShell.ts`、`useEscBack.ts`、`moduleEscapeHost.ts`
- 列表 / 主从：`useQxListSelection.ts`、`useQxMasterDetail.ts`
- 搜索 / loading UI：`src/components/QxModuleSearch.tsx`、`QxListLoading.tsx`
- 插件作者入口：[`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md)
- 市场仓库 Agent 地图：`qx-plugins/AGENTS.md`（与本表对照）

内置模块图标由 `src/modules/builtinIcons.ts` 统一注册，Launcher 与 Settings
插件界面共同消费。图标必须按 `builtin:<module-id>` 精确解析；命令标题与路径
只是可见内容，不能用于猜测模块图标。

## 抽象层一览（宿主 React vs 插件 iframe）

| 能力 | 内置 React 端口 | 插件 `context.*` 端口 | 权限 / 备注 |
|------|-----------------|----------------------|-------------|
| 壳 chrome（Esc 胶囊、Actions 菜单 kbd、Island 文案） | **`useQxModuleShell`** | 无 1:1 壳；Panel 自绘 DOM，宿主 `PluginHost` 仍包一层 QxShell | 内置必走 shell；插件 panel 打开时宿主 shell 提供 Esc leave → launcher |
| Esc 阶梯（inner → query → leave） | `useEscBack` / `shell.stepBack` | 插件 iframe 内自理；宿主 window Esc → `tryModuleEscapeStep` 再 leave 模块 | 见 UI_SPEC Esc |
| Host Esc 跨焦点 | **`moduleEscapeHost`** + `App.performHostEscape` | 同左（打开的是插件 tab 时，PluginHost 的 shell 注册 stepBack） | 禁止非 launcher 直接 `setTab` 跳过模块阶梯 |
| 列表选中 / 滚入视口 | **`useQxListSelection`** | 声明式 Workbench List/Gallery 由宿主处理；custom panel 自理 | DOM：`qx-list-row` + `is-active`；宿主乐观选择后通知插件；隐藏 Workbench iframe 的集合导航键转交宿主 Shell |
| 主从键盘区域 | **`useQxMasterDetail`** | 插件可选自实现 region | 与 QxShell.navigation 配合 |
| 模块搜索框 | **`QxModuleSearch`** | Workbench 由宿主渲染受控 query；custom panel 自绘 input | Workbench handler 必须同步回画；Launcher 搜索另见 SearchBar |
| 列表 loading | **`QxListLoading`** | 插件自绘 skeleton | — |
| 网络 | `invoke` 领域命令 / 直接 provider | **`context.http.fetch`** 或 **`invoke:cmd`** | 插件需 `http` 或精确 `invoke:` |
| 跨会话缓存 | localStorage / Rust 磁盘缓存 | **`context.storage.persist`** | SWR：先画缓存再刷新 |
| 进程内缓存 | React state / ref | **`context.storage.session`** | — |
| 灵动岛 | `island` prop / islandHost | **`context.island`** | 权限 `island` |
| CLI | 不暴露给模块业务（走 Rust） | **`context.cli`** | 权限 `cli` |
| 打开外链 | `@tauri-apps/plugin-opener` | **`context.openUrl`** | `open-url` |

**原则（与 architecture-principles 一致）**：缺口修**端口一次**，不要在每个模块/插件里 fork 一套 Esc 或缓存。

---

## 内置模块（`src/modules/*`）

| 模块 | 表面 | Shell / Esc | 列表 / 主从 | 搜索 loading | 数据 / 缓存 | 缺口 / 备注 |
|------|------|-------------|-------------|--------------|-------------|-------------|
| **clipboard** | 全屏面板 | `useQxModuleShell` + stepBack | `useQxListSelection` | `QxModuleSearch` | Rust clipboard DB | 无重大缺口 |
| **rss** | feeds / articles / detail | shell 各层；`goBack` 嵌套 | `useQxListSelection` + `useQxMasterDetail`（文章） | `QxModuleSearch` + `QxListLoading` | `rss.db` + 默认目录 seed + 阅读进度 | 嵌套 leave 已对齐 host Esc；进度节流持久化 |
| **documents** | 文件列表 + 编辑 | shell | list + master-detail | `QxModuleSearch` | 本地文件 invoke | 无重大缺口 |
| **screencap** | 录制 / 预览 | shell + 录制 inner Esc | `useQxListSelection` + list/gallery + detail | 标题槽（非搜索） | Rust capture | 布局选择持久化；双 QxShell 分支仍可接受 |
| **macros** | 录制器 | shell | — | — | macro store | 无重大缺口 |
| **qx-tty** | 终端 | shell | 侧栏 session 自管 | — | PTY invoke | 可选将来 `useQxSelectableList` |
| **qx-ai** | list / chat / settings | shell（含 chat/settings leave 父级） | list selection（会话） | `QxModuleSearch` + loading | AI store | 无重大缺口 |
| **settings** | 设置壳 | shell（query=筛选） | — | `QxModuleSearch` | settings store | 无重大缺口 |
| **v2ex**（内置） | 面板 | shell | list + master-detail | search + loading | `invoke:v2ex_*`（宿主磁盘缓存） | **默认关闭**；市场插件为主 |
| **weather**（内置） | 面板 | shell | — | — | `fetch_weather*` + localStorage | **默认关闭**；市场插件为主 |
| **onboarding** | 向导 | 专用 UI | — | — | permissions | 非 QxShell 业务面板，合理例外 |
| **github-calendar** | 小组件 | 非主 tab | — | — | 网络 | 非主模块 tab |
| **catalog / moduleAvailability** | 元数据 | — | — | — | — | 端口注册表辅助 |

**App 级过渡壳**（`ModuleLoadingShell` / `ModuleErrorShell`）：应使用 `useQxModuleShell`（与业务模块同一 Esc 注册路径）。

---

## 市场插件（`qx-plugins` `src/*`）

| 插件 id | panel 注册 | AGENTS.md | 主要端口 | 缓存 | 缺口 |
|---------|------------|-----------|----------|------|------|
| **pomodoro-island** | ✅ manifest + export | ✅ | **host Workbench** + background heartbeat + host countdown/action island + notifications | persist state/history/deadline | 声明式 list/detail/actions/island/backgroundPoll 样板；关闭面板继续计时；docked/float 同款暂停按钮 |
| **weather** | ✅ | ✅ | http + invoke weather* | persist SWR | 无 |
| **v2ex** | ✅ | ✅ | http + invoke v2ex* | persist SWR + host disk | 无 |
| **brew** | ✅ | ✅ | **host Workbench List** + cli/open-url | — | 原生 tabs/list/detail/Actions；`panel.render` 快返回 |
| **unsplash** | ✅ | ✅ | **host Workbench Gallery** + http/system/cli/file ports | persist last search | 原生 Gallery + item/panel Actions |
| **external-display-control** | ✅ | ✅ | invoke external-displays | — | 无 |
| **qx-bing-wallpaper** | ✅ | ✅ | **host Workbench Gallery** + http/system/cli/file ports | persist SWR | Qx 原生 Gallery + item/panel Actions；无 Raycast shim |
| **raycast-calendar** | ✅ | ✅ | Raycast shim | — | 转换插件 |
| **qxgh** (QxGH) | ✅ | ✅ | **host Workbench**：结构化 detail/actions + 公开 HTML + island | persist SWR | 不用 api.github.com；解析 actions/releases 网页 |

**老包兼容**：无 `AGENTS.md` 仍可安装；无 `panel` 的纯 command 包仍可跑命令，但**不能**作为 panel tab 打开（宿主不注册 panel）——这是原有契约，不是新门槛。

---

## 推荐复用路径（新功能）

### 新内置模块

1. `useQxModuleShell({ leave, esc, islandState, onKeyDown, t })`
2. 列表 → `useQxListSelection` + 可选 `useQxMasterDetail`
3. 搜索 → `QxModuleSearch`；loading → `QxListLoading`
4. 不要手写 `useEscBack` + 自定义 `kbd: CmdOrCtrl+K`（用 `shell.secondaryAction`）

### 新市场插件

1. `src/<id>/{manifest.json,index.js,README.md,AGENTS.md}`
2. 用户能打开面板 → **同时**写 `manifest.panel` 与 `export default.panel`
3. 慢数据 → `context.storage.persist` SWR；能复用宿主命令则 `invoke:` 保留 host 磁盘缓存
4. 列表/详情型插件优先 `mountWorkbench(state, handlers)`；仅复杂可视化使用 custom panel
5. `npm run package:plugins`；zip 内自带 AGENTS.md 方便后续 Agent 维护

### 明确不要复用的

- 不要在插件里依赖 React `useQxModuleShell`（沙箱无 React 壳）
- 不要为每个插件复制一套全局 Esc 监听
- 不要把 Raycast shim 当成通用列表端口（仅转换插件）

---

## 与本轮代码对齐

| 动作 | 状态 |
|------|------|
| 业务模块统一 `useQxModuleShell` | 已完成（clipboard/rss/docs/…） |
| Loading/Error 过渡壳对齐 shell 端口 | 见 `App.tsx` ModuleLoading/ErrorShell |
| 市场 pomodoro panel 注册 | 已修复（1.1.0） |
| 内置 weather/v2ex 默认关闭 | 已完成；宿主 API 保留给插件 |

维护：增减主 tab 模块或市场插件时，**同 PR 更新本表**。
