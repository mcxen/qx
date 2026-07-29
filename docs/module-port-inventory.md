# Built-in modules & marketplace plugins — port inventory

> 状态：Current · 适用版本：v0.6.0+ · Owner：Core · 最后复核：2026-07-20
> 目的：一次看清**可复用抽象**落在哪些模块、还有哪些缝。写新插件/新内置时先读这份 + 作者手册。

相关：

- 宿主模块 shell：`src/hooks/useQxModuleShell.ts`、`useEscBack.ts`、`moduleEscapeHost.ts`
- 列表 / 主从 / 网格：`useQxListSelection.ts`、`useQxMasterDetail.ts`、`qxGridNavigation.ts`
- Actions：`src/components/QxActionPanel.tsx`（消费统一 `QxShellAction`）
- 搜索 / loading UI：`src/components/QxModuleSearch.tsx`、`QxListLoading.tsx`
- 插件作者入口：[`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md)
- 市场仓库 Agent 地图：`qx-plugins/AGENTS.md`（与本表对照）

内置模块图标由 `src/modules/builtinIcons.ts` 统一注册，Launcher 与 Settings
插件界面共同消费。图标必须按 `builtin:<module-id>` 精确解析；命令标题与路径
只是可见内容，不能用于猜测模块图标。

## 抽象层一览（宿主 React vs 插件 iframe）

| 能力 | 内置 React 端口 | 插件 `context.*` 端口 | 权限 / 备注 |
|------|-----------------|----------------------|-------------|
| 壳 chrome（Esc 胶囊、Actions 菜单、Island 文案） | **`useQxModuleShell`** | 无 1:1 壳；宿主 `PluginHost` 包一层 QxShell | 内置必走 shell；插件 panel 打开时宿主 shell 提供 Esc leave → launcher |
| Esc 阶梯（inner → query → leave） | `useEscBack` / `shell.stepBack` | 插件 iframe 内自理；宿主 window Esc → `tryModuleEscapeStep` 再 leave 模块 | 见 UI_SPEC Esc |
| Host Esc 跨焦点 | **`moduleEscapeHost`** + `App.performHostEscape` | 同左（打开的是插件 tab 时，PluginHost 的 shell 注册 stepBack） | 禁止非 launcher 直接 `setTab` 跳过模块阶梯 |
| 列表选中 / 滚入视口 | **`useQxListSelection`** | 声明式 Workbench List/Gallery 由宿主处理；custom panel 自理 | DOM：`qx-list-row` + `is-active`；List 的 `item.image` 为行缩略图，`item.images[]` 为社区动态紧凑卡片，`detail.image(s)` 为自适应右侧媒体且可用 `mediaPlacement="after-body"` 跟随文章正文；详情图片集合按插件发布数量完整呈现，不人为截断；需要原位图文顺序的长文使用纯数据 `detail.content[]` text/image 块；Workbench 与内置 RSS 共用 `QxMediaViewer`，全尺寸预览统一横图按宽、竖图按高、超长截图按宽滚动，并由宿主预解码相邻图片（缓存是性能策略，不是集合上限）；预览左下角提供下载原图；`detail.replies` 由共享 `QxReplyList` 在底部显示 `#楼号`、作者、时间与 OP，内置 V2EX 同样复用；宿主提供失败态/放大预览，`item/detail.status` 通过共用 activity 字段表达真实百分比或 completed/total/failed，`detail.form` 为宿主渲染的 text/number/select 受控参数表单；`mountWorkbench()` controller 的 `updateItems` 按稳定 id 增量/批量合并并仍发布完整快照；浏览态全宽集合，激活带详情条目后由宿主挂载左集合 + 右详情；宿主乐观选择后通知插件；隐藏 Workbench iframe 的集合导航键转交宿主 Shell；详情打开后 region 键驱动当前集合或阅读区 |
| 主从键盘区域 | **`useQxMasterDetail`** | 插件可选自实现 region | 与 QxShell.navigation 配合 |
| 二维网格索引 | **`qxGridNavigation`** | Workbench Gallery 由宿主处理 | 通用纯函数；不得放回 PluginHost 专用算法 |
| Actions 数据 / 右栏渲染 | **`QxShellAction[]` + `primaryActionId` + `QxActionList`** | Workbench 发布纯 action descriptor + primary id，宿主映射一次 | 稳定动作 ID 驱动 Bottom Bar 与 Enter；完整 Context 型页面只投影非 primary 业务动作并关闭重复 Actions 菜单。manifest 启动/后台命令及宿主 reload 不混入插件业务 Action；Shell 通过 `data-qx-list-index` + `navigation.onChange` 统一处理条目右键，模块不得复制菜单 |
| 模块搜索框 | **`QxModuleSearch`**（默认不自动聚焦；首要搜索页显式 `autoFocus`） | Workbench 由宿主渲染受控 query；custom panel 自绘 input | Workbench handler 必须同步回画；pointer 进入表单/详情后不得抢回搜索焦点；Launcher 搜索另见 SearchBar |
| Top Bar 内容筛选 | **`QxShell.topbarFilters`**（宿主固定 Select） | Workbench `tabs[] / filters[]` 由 PluginHost 投影；custom panel 应改用 Workbench | 模块/插件只发布 `id / label / value / options`；不得在 `trailing` 自绘 tabs、SegmentedControl 或 Select；命令按钮进入 Bottom Bar / Actions |
| 列表 loading | **`QxListLoading`** | Workbench 由宿主保留旧数据或渲染 skeleton；custom panel 自理 | 不得把加载态做成整页空白 |
| 网络 | `invoke` 领域命令 / 直接 provider | **`context.http.fetch`** 或 **`invoke:cmd`** | 插件需 `http` 或精确 `invoke:` |
| 跨会话缓存 | localStorage / Rust 磁盘缓存 | **`context.storage.persist`** | SWR：先画缓存再刷新 |
| 进程内缓存 | React state / ref | **`context.storage.session`** | — |
| 宿主缓存统计 / 清理 | **`storage` 注册表 + `StorageSettings`** | `manifest.storage.cacheTargets[]` 精确登记可重建 persist keys；未登记插件数据仍受保护 | Settings → System → Storage Management 只消费 `cache_targets`；`qx_storage_overview` 与 `qx_storage_clear_cache_target` 共用目标；插件目标为 `plugin:<id>:<cache-id>`，只清 key 白名单 |
| Launcher Home 组件 | **`src/home-dashboard` 注册目录 + `home-island/data`** | `manifest.homeWidgets[]` 只关联受支持的 `system.*` 数据源与插件 Panel | 宿主绘制、采样、响应式和焦点；插件不得提供 DOM/CSS/轮询。置顶应用复用 `search_metadata` pin 协议 |
| 灵动岛 | `island` prop / **`islandHost`** | **`context.island`** | 权限 `island`；真实进度可声明宿主受控 `progressStyle`（默认 `surface-fill`，另有 `icon-ring/island-ring/compact-line`），禁止插件注入视觉代码；`QxShell.islandKey` 必须稳定并由 Shell 绑定内置模块 `openTarget`；插件目标由 bridge 绑定；store 单写、DockSlot 单渲染；前台非粘性 location 高于后台粘性轮播；桌面浮窗只由用户从 Qx 手动浮出并可关闭 |
| 主题 / 语义 token | `ThemeProvider` + `base.css` | Workbench 由 host 渲染；Custom Panel 由 `pluginTheme` 注入 | 同步 resolved Light/Dark、`.dark`、公开 shadcn/Qx token；插件 UI 规范见 `public/doc/plugin-ui-guidelines.md` |
| 语言 / 本地化 | `useLocale` / `useT` | **`context.locale.current` / `preference` / `onChange`** | 无权限；值是 Qx 生效语言而非浏览器语言。插件用 `current` 匹配文案与 `Intl`，不得读取 `navigator.language` 推测 Qx 设置 |
| CLI | 不暴露给模块业务（走 Rust） | **`context.cli`** | 权限 `cli` |
| 系统信息 / 设置 / 下载 | Rust `qx_system_information_*` / `display_list` 领域命令 + `plugin_system_save_download` | **`context.system.info/storage/displays/network/networkCounters/power/processes/openSettings/saveDownload`** | typed 跨平台 model；显示器模型含分辨率/刷新率/缩放/旋转及可用的连接协议/EDID 标识；OS API、PowerShell/AppKit URL 和 Downloads 路径只存在于宿主 adapter |
| 本地路径打开 / 揭示 | **`src/system/pathActions.ts`** | **`context.system.openPath/revealPath`** | 共用 Rust 语义端口；macOS 不先 canonicalize Spotlight 路径，Windows 不经过 WebView opener ACL |
| 打开外链 | `@tauri-apps/plugin-opener` | **`context.openUrl`** | `open-url` |
| OCR 识别 / 历史 | `src/system/ocr.ts` + 设置历史 | **`context.ocr.*`**（`recognizePath` / `recognizeClipboardImage` / `listHistory` / …） | 权限 `ocr`；宿主 Settings → OCR 启用；支持 `no-view`+`interval` 后台定时 |
| 打开宿主 Settings（带回程） | **`openSettings` / `closeSettings`**（`modules/settings/openSettings.ts`） | 插件 panel：`qx:plugin:open-preferences` → 同端口 | 禁止 `setTab("settings")` + 手写 sessionStorage；Esc leave 回调用方模块/插件 |

**原则（与 architecture-principles 一致）**：缺口修**端口一次**，不要在每个模块/插件里 fork 一套 Esc 或缓存。

底栏 Action 入口属于宿主 chrome，不属于模块文案：所有模块固定显示“操作”
（英文 `Action`）以及平台化的 `Cmd/Ctrl+K` 提示。窄窗口可以省略 Island
次要信息，但不得隐藏 Action 快捷键提示或让它参与文本截断。
剪贴板浏览态以 Bottom Bar `primaryActionId="paste"` 投影动作显示“粘贴到 {前台应用} ↵”，位置固定
在 Action 左侧；编辑态使用 Island trailing actions 显示“保存 / 另存为新条目”，
保存成功使用宿主 `orbit` effect 提供一次性反馈。
剪贴板文件条目必须保留有序 `file_paths` 与主项 `file_path`、稳定 `file_kind`（含
`folder`）；列表和详情消费该字段，不得以“是否有扩展名”猜测文件夹。多选文件是一个
原生 file-list 条目并整体回写，不能拆成互不相关的历史项；旧条目缺少新字段时才以
`file_path` 和路径扩展名作兼容回退。

---

## 内置模块（`src/modules/*`）

| 模块 | 表面 | Shell / Esc | 列表 / 主从 | 搜索 loading | 数据 / 缓存 | 缺口 / 备注 |
|------|------|-------------|-------------|--------------|-------------|-------------|
| **clipboard** | 全屏面板（**核心**，eager import） | `useQxModuleShell` + stepBack | `useQxListSelection` | `QxModuleSearch` | Rust clipboard DB；**打开端口** `openSession.prefetchClipboardOpen`（热窗口 history 并发；idle warm；SWR 先画 store）；**冷存储** `loadMoreClipboardHistory`（列表滚到底 / 键盘近底加载） | 快捷键打开：navigate 即预取热窗口，滚底再拉更早记录；面板非 lazy |
| **rss** | feeds / articles / detail | shell 各层；`goBack` 嵌套；仅发布一个上下文 Enter 主动作 | `useQxListSelection` + `useQxMasterDetail`（文章） | `QxModuleSearch` + `QxListLoading` | `rss.db` + 默认目录 seed + 阅读进度 + 64px 本地图标缓存 + 正文图片缓存 + `rss_meta.last_refresh_all_at` | 右侧 Context 是唯一完整 Action 面并按领域分组，不再投影 Bottom Bar Actions 菜单或裸键；Enter 依次进入订阅 / 阅读文章 / 下一篇。嵌套 leave 已对齐 host Esc；单 Feed 刷新用 activity，刷新全部按 Rust `rss:refresh-progress` 的真实 completed/total 驱动 Island；后台刷新可在 Settings 选择关闭或 6 / 12 / 24 小时，复用同一全量流程与刷新锁，面板未挂载也可运行，手动全量刷新重新计时；favicon 30 天复用并支持 stale fallback；正文远程图片通过 `rss_cache_article_image` 复用宿主代理并转成本地 asset URL，避免 WKWebView / WebView2 网络栈差异 |
| **documents** | 文件列表 + 编辑 | shell | list + master-detail | `QxModuleSearch` | 本地文件 invoke | 无重大缺口 |
| **screencap** | 录制 / 历史主从预览 | shell + 录制 / 详情 inner Esc | `useQxListSelection` + list/gallery + right-side detail | 标题槽（非搜索） | Rust capture | 布局选择持久化；Windows RDP still-frame 走 GDI，picker ready 后重放 session；截图完成由宿主 Island 提供快捷复制；权限动作统一由捕获灵动岛承载 |
| **macros** | 录制器 | shell | — | — | macro store | 无重大缺口 |
| **qx-tty** | 终端 | shell | 侧栏 session 自管 | — | PTY invoke | 可选将来 `useQxSelectableList` |
| **qx-ai** | list / chat / settings | shell（含 chat/settings leave 父级） | list selection（会话） | `QxModuleSearch` + loading | AI store | 无重大缺口 |
| **settings** | 设置壳 | shell（query=筛选）；leave=`closeSettings` | — | `QxModuleSearch` | settings store + **`openSettings` returnTo** | 模块深链进设置后 Esc 回调用方，不再一律 launcher |
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
| **pomodoro-island** | ✅ manifest + export | ✅ | **host Workbench** + background heartbeat + host countdown/activity/action island + notifications | persist state/history/deadline | **QxIsland 首个规范样板**：running=`pulse + endsAt`、paused=冻结 countdown、complete=100%；插件不能自动弹窗，用户手动浮出后可关闭，打开目标由 host 固定回插件 Panel |
| **weather** | ✅ | ✅ | http + invoke weather* | persist SWR | 无 |
| **v2ex** | ✅ | ✅ | http + invoke v2ex* | persist SWR + host disk | 无 |
| **qxheihe** | ✅ | ✅ | **host Workbench List + 多图详情 + 评论树** + http/open-url | persist SWR | 小黑盒公开 feed/详情；匿名优先读取评论树，Cookie 仅作可选增强；风控时保留缓存并提示验证 |
| **qxtieba** | ✅ | ✅ | **host Workbench List + 主楼详情 + 楼层评论** + http/open-url | persist SWR + 已读状态 | 默认图拉丁吧/笔记本吧，支持多贴吧标签与并发交错的混合 Feed；游客态移动/桌面公开页面双回退；首屏楼层通过共享 `detail.replies` 展示，风控失败时保留缓存并提供原帖跳转 |
| **qxcoolapk** | ✅ | ✅ | **host Workbench List + media filmstrip + replies + filters + article island** + http/open-url/system | persist SWR + 已读优先有界缓存 | 酷安文章原文/图片加载投影到灵动岛；动态多图走宿主胶片与大图预览，回复走底部 `detail.replies`；原图下载由宿主保存到 Downloads；已读/未读筛选与批量清理均走宿主端口 |
| **qxweibo** | ✅ | ✅ | **host Workbench List + media filmstrip + replies + detail island** + http/open-url/system | persist SWR + session image proxy | 指定用户与受控聚合关注流；多游客 Cookie 轮换、串行随机间隔；微博图床走会话代理，原图下载由宿主保存到 Downloads，首屏评论走底部 `detail.replies` |
| **brew** | ✅ | ✅ | **host Workbench List** + cli/open-url | — | 全宽 List → 宿主左集合/右详情；原生 tabs/Actions；`panel.render` 快返回 |
| **unsplash** | ✅ | ✅ | **host Workbench Gallery** + http/system wallpaper/file ports | persist last search | 全宽 Gallery → 宿主左图库/右详情；item/panel Actions；与 Bing 复用宿主壁纸端口 |
| **external-display-control** | ✅ | ✅ | invoke external-displays | — | 无 |
| **qx-bing-wallpaper** | ✅ | ✅ | **host Workbench List（缩略图）** + http/system wallpaper/file ports | persist SWR | 宿主左侧缩略图列表/右侧高清详情；窄详情栏不堆叠；item/panel Actions；壁纸系统差异由 host port 适配；无 Raycast shim |
| **raycast-calendar** | ✅ | ✅ | Raycast shim | — | 转换插件 |
| **qxgh** (QxGH) | ✅ | ✅ | **host Workbench**：结构化 detail/actions + 公开 HTML + island + tray | persist SWR | 不用 api.github.com；解析 actions/releases 网页；活跃部署以原生托盘子菜单显示预计百分比与用时 |
| **sysinfo** | ✅ | ✅ | **host Workbench List** + typed system/info/storage/network/power/process ports + `homeWidgets` | — | CPU/Memory/Power/Network 通过 Manifest 与宿主 Home 组件关联，卡片仍由 Qx 共享采样总线绘制；Hardware 面板同轮 5 秒刷新且整轮 single-flight，静态规格与 Storage 保持 runtime cache；Windows 端口直接使用 Win32，不启动 PowerShell/WMI 采样进程；Processes 可操作且结束需 `YES` 确认；无 shell、自绘 Home DOM 或 CSS |

**老包兼容**：无 `AGENTS.md` 仍可安装；无 `panel` 的纯 command 包仍可跑命令，但**不能**作为 panel tab 打开（宿主不注册 panel）——这是原有契约，不是新门槛。

---

## 推荐复用路径（新功能）

### 新内置模块

1. `useQxModuleShell({ leave, esc, islandState, onKeyDown })`
2. 列表 → `useQxListSelection` + 可选 `useQxMasterDetail`；网格索引 → `qxGridNavigation`
3. 搜索 → `QxModuleSearch`；loading → `QxListLoading`
4. Context Actions → `QxActionList`，并把同一 `QxShellAction[]` 交给 Shell，以 `primaryActionId` 引用主动作
5. 不要手写 bare Enter、Actions 触发器或 `kbd: CmdOrCtrl+K`；QxShell 从同一动作集合派生

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
