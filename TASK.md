> Settings/About 面板的结构、设计令牌、Row/Card 规范与响应式断点见 [docs/settings-panel.md](docs/settings-panel.md)。

## Bugfix — 文本工具编辑键与 QxShell 导航抽象

**状态**：已实现，等待发布包运行态复核。

### 修复内容

- 修复 QxShell 在 textarea 编辑焦点中仍用 ArrowUp / ArrowDown / PageUp / PageDown 切换文件的问题；编辑器完整保留原生光标、选区和内容滚动。
- 抽出 `navigationModel` 纯逻辑层与 `useQxShellNavigation` DOM/React 适配层，统一负责区域激活、左右区域切换、列表移动和阅读内容滚动。
- `QxShell.navigation` 新增 `regionId` 和 `editable` 策略；默认仅允许 Shell 搜索框用上下/Page 键驱动列表，普通 input、textarea、contenteditable 不被 Shell 抢键。
- Documents 文件列表绑定 `docs-files` 区域，移除模块内重复的上下键索引代码；搜索框输入裸字母不再误触发 New File。
- 新增无 DOM 的导航模型回归脚本，覆盖列表边界、Page/Home/End、编辑焦点保护和内容滚动步长。

### 验证

- [x] `npm run test:shell-navigation`。
- [x] `npx tsc --noEmit`。
- [x] `npm run build`。
- [ ] macOS 发布包：编辑器上下键不换文件、列表上下键换文件、搜索框上下键仍导航。
- [ ] Windows Compatibility Action 与 Windows 文本编辑键盘验证。

## Bugfix — V2EX 系统代理与请求竞态

**状态**：已修复并完成 macOS 联网验证。

### 修复内容

- `reqwest` 补启用 `system-proxy` feature：未配置 Qx 手动代理时自动读取 macOS System Configuration / Windows 系统代理；Qx 手动代理开启时仍优先使用用户填写的 URL。
- 移除 V2EX 面板首次挂载时重复发出的主题请求，避免无意义地同时请求两次 API。
- 为主题加载增加递增 request id；搜索或 Latest / Hot 快速切换时，过期请求的成功或失败结果都不能覆盖当前结果。

### 验证

- [x] V2EX `latest.json` / `hot.json` 实际联网返回 HTTP 200。
- [x] `cargo tree -e features -i reqwest@0.12.28` 确认 `system-proxy` 已启用。
- [x] `npx tsc --noEmit`。
- [x] `cargo check`（通过，保留项目既有 2 个 warning）。
- [x] `npm run tauri build`，ad-hoc 重签并安装至 `/Applications/Qx.app`。
- [x] 新安装包实际验证：Latest 45 条、Hot 10 条；Latest / Hot 连续快速切换后最终模式与列表一致，无网络错误。
- [ ] Windows Compatibility Action 与 Windows 系统代理环境手动验证。

## UI polish — Extensions 管理区紧凑化

**状态**：已实现并完成 macOS 视觉验证。

### 调整内容

- 移除 Installed 页首屏的大型 Display / 导入说明卡片，收敛为 Tabs、Raycast Actions、导入与重新扫描组成的单层工具栏。
- 导入本地压缩包、GitHub archive 和 Raycast extension URL 改由独立 Dialog 承载，打开后自动聚焦第一个输入框。
- 搜索、筛选与模块网格直接前置；工具栏在窄宽度下可换行，避免按钮和标签挤压。
- 补齐 Extensions 管理器的中英文标签、空状态、筛选项与无障碍开关名称。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run tauri build`，安装并启动 `/Applications/Qx.app`。
- [x] macOS 默认窗口宽度视觉检查：工具栏、搜索筛选、模块网格无重叠或截断。
- [x] 导入 Dialog 视觉与键盘焦点检查；无输入时三个安装动作保持禁用。
- [ ] Windows 手动验证：默认宽度、窗口缩窄换行与导入 Dialog。

## Feature — Launcher 搜索与当前窗口显隐独立快捷键

**状态**：已实现，待双平台手动验证。

### 调整内容

- 原 `toggle_launcher` 保留设置键与既有切换语义：隐藏时显示 Qx、切到 Launcher 并聚焦搜索，已显示时再次按下隐藏。
- 新增 `toggle_window`：只切换主窗口显隐，隐藏后再显示保留当前模块、route 和子界面。
- Launcher 搜索切换默认 `Alt+Space` 并启用；当前窗口切换预设 `Alt+Shift+Space` 但默认关闭，两者均可在 Settings → Shortcuts 单独录制和启停。旧设置会自动补齐新增快捷键项，同时保留用户已有绑定。
- 快捷键设置补齐中英文标签、语义说明与按钮文案，并允许 Qx 自身注册默认 `Alt+Space`，仍拦截系统 `Cmd/Ctrl+Space`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在当前工作区既有 warning）
- [x] `cargo test --lib settings::tests::default_global_shortcuts_only_enable_launcher_recall -- --nocapture`
- [x] `npm run tauri build`，ad-hoc 重签后安装到 `/Applications/Qx.app` 并启动成功。
- [ ] Windows Compatibility Action：`cargo check --target x86_64-pc-windows-msvc` 与 NSIS bundle build。
- [ ] 手动验证：RSS / Clipboard / Settings 内纯显隐保留界面；Launcher 快捷键始终进入搜索并聚焦；快捷键冲突、重置、启停立即重注册。

## UI polish — macOS / Windows 主窗口原生阴影

**状态**：已实现，待双平台手动验证。

### 调整内容

- Tauri 主窗口启用 `shadow`，Windows 无边框窗口由 DWM/Tao 绘制阴影与 Windows 11 系统圆角。
- macOS 浮动窗口恢复 AppKit 原生阴影，并在应用 borderless style mask 后重新计算阴影。
- WebView 画布移除会被窗口边界裁剪的外阴影，只保留语义 token 控制的内高光，避免与系统阴影叠加成黑边。

### 验证

- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在当前工作区既有 warning）
- [x] `npm run tauri -- build --debug --no-bundle`，本地 `target/debug/qx` 启动烟雾中进程保持运行。
- [ ] Windows Compatibility Action：`cargo check --target x86_64-pc-windows-msvc` 与 NSIS bundle build。
- [ ] macOS / Windows 手动验证：浅色/深色桌面上阴影层次、Windows 10/11 边框与圆角、点击阴影外部失焦隐藏、缩放与跨 DPI 显示器。

## Refactor — 直接视频录屏与受保护悬浮控制台

**状态**：已实现，macOS 构建、核心编码测试与启动烟雾通过；等待 Windows CI 和双平台手动录屏验证。

### 截图与多显示器统一捕获（2026-07-15）

- 显示器枚举、稳定 ID、内置/外接/主屏判断、鼠标所在屏幕和 Tauri/捕获后端映射提升为 Qx 系统级服务；截图模块只保留圈选几何、裁剪与录制状态，热插拔监听复用系统服务。
- 修复首次启动后第一次唤起落到隐藏窗口创建显示器或旧 macOS Space：标准化鼠标坐标优先、原生坐标仅兜底，窗口显示后重新按目标 DPI 校正，并使用 active-Space 窗口策略。
- 截图以 PNG 接入现有捕获历史和预览，和 MP4/MOV/GIF 共用清理与文件输出目录。
- 区域圈选初始按鼠标所在显示器解析捕获源，并提供内置屏/外接屏显式切换和全屏入口；记录 xcap 显示器 ID，避免外接屏错误回落到主屏。
- Launcher 新增“开始截图 / 开始录制”独立 command；Shortcuts 新增默认关闭的截图快捷键，录屏快捷键改为直接开始圈选。
- Shortcuts 新增默认关闭的“显示/隐藏捕获灵动岛”（`Alt+Shift+C`）动作；截图完成动作可选自动复制到剪贴板或仅保存，复制失败不回滚已保存历史。
- 原录制控制条扩展为空闲捕获灵动岛，可由用户选择长期置顶外显；空闲提供截图/录制，录制时保持原停止与状态能力。
- 捕获岛新增历史入口；历史区重构为 Qx 标准左侧行列表（类型图标、主信息、元信息、行内删除）与右侧预览/配置分栏，移除嵌套交互按钮和大段行内样式。
- 圈选改为两阶段确认：首次框选后可移动、四角缩放，再选择截图或录制；截图可添加文字和箭头，浏览器生成透明标注层，Rust 按捕获实际像素缩放并合成进 PNG。
- 修复捕获入口先隐藏全部 Qx 窗口、选区打开失败后看似整应用闪退的问题：选区成功映射后才隐藏来源窗口，失败时保留原界面并记录诊断。
- 区域录制期间保留受保护、鼠标穿透的录制边框，录制岛定位到边框下方；停止后恢复原选区的拖动、缩放和重复捕获，不再强制丢弃选区返回主界面。

### 重构内容

- 修复 `scrap` 帧缓冲行填充被当作紧密 RGBA 数据的问题；Retina / 高 DPI 帧现在按真实 stride 逐行转换。
- 录屏不再逐帧写临时 PNG、停止后再集中编码 GIF；改为录制时由内置 OpenH264 直接编码 H.264，并持续封装为 MP4（默认）或 MOV。
- 用户可设置输出格式、720p / 1080p / 原始分辨率、15 / 24 / 30 fps 和紧凑 / 均衡 / 高画质；设置保存在本机。
- 录制时间轴使用真实帧间隔，即使编码负载导致掉帧也不会把视频快放。
- 录制完成后的预览支持 MP4 / MOV 播放，并提供独立的 GIF 宽度与帧率转换选项；GIF 转换在阻塞工作线程执行。
- 新增 Rust 共享录制状态、帧计数和 `screencap:state` 事件，主 QxShell 与独立 WebView 控制台读取同一状态。
- 录制默认停留在主界面灵动岛；同一套 340×36 控制条可通过轻量收缩淡出在主界面与独立、置顶、跨 DPI 定位的悬浮窗口之间双向迁移，状态与操作位置保持一致。
- 主窗口和悬浮控制台在录制期间启用 Tauri 内容保护（macOS `NSWindowSharingNone` / Windows capture exclusion），避免控制界面进入录制画面。
- 录屏停止/封装保持在 `spawn_blocking` / 专用线程；主窗口、搜索与快捷键响应链不承担编码工作。
- 输出清理、Launcher 文案、模块搜索关键词、权限说明和中英文 UI 已从“GIF 录制”更新为“视频录制，可选转 GIF”。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `cargo test --lib`（34 个测试通过；新增 stride、偶数分辨率、AVCC/Annex-B 与真实 H.264→MP4 mux 测试）
- [x] `npm run tauri -- build --debug --no-bundle`
- [x] 本地 `target/debug/qx` 启动烟雾，Rust 后台进程保持运行、无启动闪退。
- [x] 完整 `cargo fmt --check`（包含既有 `text_toolbox.rs` 格式修正）。
- [x] `npm run tauri -- build --target aarch64-apple-darwin --bundles app`。
- [ ] Windows Compatibility Action：`cargo check --target x86_64-pc-windows-msvc` 与 NSIS bundle build。
- [ ] macOS / Windows 手动验证：全屏与选区录制、悬浮控制台不进入画面、返回 Qx / 再次悬浮、MP4/MOV 播放、GIF 转换与混合 DPI 定位。

## Feature — Beta 内置模块标识与按需禁用

**状态**：已实现，等待静态与手动验证。

### 新增内容

- Screen Recording、Weather、V2EX、Macro Recorder 统一登记为 Beta 模块，模块标题、Launcher 快捷入口/搜索结果和 Extensions 模块卡使用浅色虚线 `Beta` 标识。
- Beta 标识 tooltip 和 Extensions 配置说明明确提示功能可能不稳定。
- Settings → Extensions → Installed 的 Beta 内置模块配置 Dialog 可启停模块，设置持久化到 `builtin_modules.modules`；旧设置缺少字段时默认保持启用。
- 禁用后 Quick Entries、静态命令、Module Surfaces、直接导航与录屏全局快捷键同时失效；App 在 lazy view 挂载前拦截，因此模块组件 effect 和 IPC 数据请求不会启动。
- Settings 仍保留禁用模块卡作为重新启用入口；General → Module Search 对已禁用模块显示关闭且不可操作，避免出现“搜索已开启但模块不可用”的冲突状态。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `rustfmt --edition 2021 --check src-tauri/src/settings/mod.rs`
- [x] `cargo check`（`src-tauri/`，通过；存在当前工作区既有 warning）
- [x] `cargo test --lib settings::tests::beta_modules_stay_enabled_for_legacy_settings_until_user_disables_them -- --nocapture`
- [ ] 完整 `cargo fmt --check`：被当前未提交的 `src-tauri/src/text_toolbox.rs` 既有格式差异阻塞，本功能改动文件已通过 rustfmt。
- [ ] 手动验证四个 Beta 模块的浅色/深色/低透明度标识；逐一禁用后入口、搜索和直接导航消失且无数据请求，重新启用后恢复。

## Bugfix — 更新检查绕过 GitHub REST API 限流

**状态**：已实现，Rust 静态验证与 updater 单测通过；等待真实网络手动验证。

### 修复内容

- 更新检查不再请求 `api.github.com/repos/mcxen/qx/releases/latest`，也不再先解析 Release 网页的 tag 重定向。
- 直接请求 GitHub 的稳定 Release 资产入口 `releases/latest/download/latest.json`，由 GitHub 重定向到最新正式版本清单。
- 从清单读取版本、macOS `.app.zip`、SHA256 与大小；清单省略资产 URL 时按 tag 和现有命名规则生成版本化下载地址。
- 自动安装前限制资产必须来自 `https://github.com/mcxen/qx/releases/download/<tag>/<asset>`，并继续执行大小、SHA256、bundle id、版本与可执行文件校验。
- macOS 自动更新继续使用 `.app.zip`；Windows `.exe` 仍为 Release 手动安装资产，当前 updater helper 不自动运行 Windows 安装器。

### 验证

- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo test --lib updater::tests -- --nocapture`（7 个 updater 测试通过）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 真实网络请求：当前环境访问 `github.com` 时 `curl` 在 TLS/proxy 层失败，无法验证 GitHub 重定向和 v0.5.3 资产下载。
- [ ] Windows Compatibility Action 与 macOS 打包应用内手动更新。

## QxAI — OpenRouter 默认供应商与 DeepSeek BYOK

**状态**：已实现，已通过前端、Rust 与文档静态验证。

- [x] 移除 DuckDuckGo 内置供应商与专用请求实现。
- [x] OpenRouter 成为默认供应商，预置官方 `openrouter/auto`。
- [x] 新增 DeepSeek 内置供应商，预置 V4 Flash / Pro。
- [x] 内置 endpoint/model 由 Qx 管理，用户只填写 API Key；密钥保存在本机状态目录。
- [x] 旧会话或设置中的 DuckDuckGo 选择自动回落到 OpenRouter。
- [ ] Windows Compatibility Action 与 Windows/macOS 真实 API Key 手动请求验证。

## UI polish — Clipboard 图标与搜索对齐

**状态**：已实现，已通过前端静态验证。

### 调整内容

- Clipboard 内容类型图标统一使用中性色；强调色仅保留给当前选中项和置顶状态。
- Clipboard 搜索统一使用 QxShell 标准 `qx-search-wrap` / `qx-plugin-search`，保留独立卡片、边框、圆角与 focus ring。
- 搜索输入文字起点与左侧列表标题列在默认、窄屏和单栏断点下精确对齐。
- Launcher 搜索卡片右边缘与 Main Area / Context Panel 分割线对齐；范围筛选独占右侧 trailing 轨道。
- 移除 Launcher Top Bar 的 Quick Entry 图标组；快捷入口继续保留在 Context Panel。
- `UI_SPEC.md` 明确列表/工具栏图标的中性色规则，以及 QxShell 搜索卡片、主列占位和列表标题对齐约束。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] Native control scan：仅命中 Markdown 内容样式 `src/styles/qx-ai.css:.qx-md-body li input[type="checkbox"]`，非产品控件。
- [ ] 手动验证 Light/Dark、480×360、680×500、980×576 下 Clipboard 搜索与列表标题对齐；Launcher 搜索右边缘与 Context Panel 分割线对齐且顶栏无 Quick Entry 图标；选中/置顶之外无彩色类型图标。

## Bugfix — Windows 透明度与失焦隐藏

**状态**：已实现，等待 Windows 构建与手动验证。

### 修复内容

- Windows WebView2 使用独立的不透明度映射，默认界面和面板不再沿用 macOS vibrancy 的低 alpha；透明度设置仍覆盖完整的 Windows 可读范围。
- Windows 10/11 尝试应用原生 Acrylic 背景，远程桌面或旧系统不支持时自动使用高不透明度 CSS 表面兜底。
- Windows 主窗口失焦隐藏下沉到 Tauri 原生 `WindowEvent::Focused(false)`；开启“失焦时自动隐藏”后，点击其他应用会立即隐藏 Qx，不再只依赖 WebView 前端焦点回调。
- 保留 launcher 可见时的 `alwaysOnTop`：它只控制层级，不应锁住系统焦点；macOS 继续使用 vibrancy + NSPanel，Windows 使用普通 HWND + Acrylic，两端走各自原生窗口语义。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] Windows Compatibility Action：`cargo check --target x86_64-pc-windows-msvc` 与 NSIS bundle build。
- [ ] Windows 手动验证：默认透明度可读；透明度滑块有效；点击 Qx 外部可激活目标窗口并隐藏 Qx；关闭自动隐藏后 Qx 保持可见但不锁焦点。

## Bugfix — Windows 安装卡死与 Everything 查询黑框

**状态**：已实现，等待 Windows 构建与手动验证。

### 修复内容

- NSIS 安装器只安装 Qx Everything 索引服务，不再通过会等待子进程退出的 `nsExec` 启动常驻索引进程；索引进程改由 Qx 首次启动时的后台初始化异步拉起。
- Windows 文件搜索统一通过带 `CREATE_NO_WINDOW` 的后台命令 helper 启动 `everything.exe` 和 `es.exe`，避免每次查询时闪现控制台黑框。

### 验证

- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] Windows Compatibility Action：`cargo check --target x86_64-pc-windows-msvc` 与 NSIS bundle build。
- [ ] Windows 手动验证：安装流程正常结束；启动 Qx 后索引可用；连续输入文件搜索时不出现黑框。

## Bugfix — 跨平台后台驻留、异步核心、Windows DPI 与快捷键兼容

**状态**：已实现，macOS 编译/单测/运行烟雾通过，等待 Windows CI 与双机手动验证。

### 修复内容

- 主窗口关闭改为隐藏并复用 WebView；Rust 托盘、全局快捷键和后台线程继续驻留，避免进程仍在但 `main` 窗口已销毁、无法再次唤起。
- 首次应用扫描和显示器枚举移到命名后台线程；系统信息、系统采样、外接显示器命令与录屏 GIF 编码使用 `spawn_blocking`，录屏编码前释放全局录制锁。
- 灵动岛系统采样增加 in-flight 门控，隐藏时暂停轮询，避免慢采样重叠堆积。
- Windows 启动器扫描用户/系统 Start Menu 的 `.lnk`，通过 `ShellExecuteW` 启动；持久化路径改用 macOS Application Support / Windows LocalAppData 兼容层。
- Windows 使用 Tauri/Wry 底层 Per-Monitor V2 DPI；窗口最小尺寸改为逻辑像素，跨 125%/200% 等不同 DPI 显示器时按目标显示器缩放预测居中，并把超大窗口限制到目标工作区 90%。
- 快捷键建立 macOS/Windows 双预设：QxShell Action 面板统一使用 `CmdOrCtrl+K`，macOS 显示/匹配 `⌘K`，Windows 显示/匹配 `Ctrl+K`；插件 iframe 获得焦点时也会把该预设转给所属 QxShell。
- Rust 全局快捷键复用 Tauri `global-hotkey` 的 `CmdOrCtrl` 解析；旧 `Cmd` 配置和插件快捷键规范化为跨平台主修饰键，显式 Windows 键仍可使用 `Super`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `cargo test --lib -- --nocapture`（27 个测试通过，含混合 DPI 定位与快捷键规范化）
- [x] macOS `tauri dev` 启动烟雾：Rust 核心持续运行，采样确认 `qx-display-monitor` 后台线程存活。
- [x] 键盘兼容抽样：macOS `Cmd K -> ⌘K`、Windows `⌘K -> Ctrl+K`，Windows 只接受 `Ctrl+K` 打开 Action 面板。
- [ ] Windows Compatibility Action：当前本机没有 `rustup`/MSVC target，需在改动推送后确认 `cargo check --target x86_64-pc-windows-msvc` 与 NSIS 构建均通过。
- [ ] 双机手动验证：关闭后快捷键再次唤起；任务运行时继续搜索/导航；Windows 在 100%/125%/150%/200% 混合 DPI 显示器间唤起、移动、缩放；`Ctrl+K` Action 面板与右侧 Context Panel 内容一致。

## Feature — Raycast ActionPanel 显示偏好与窄屏收起

**状态**：已实现，等待验证。

### 新增内容

- Settings -> Extensions -> Installed 新增 Display 卡片，可控制转换后的 Raycast `ActionPanel` 行内按钮是否显示。
- 插件 runtime 新增同步 `context.display.raycastActionPanel`，并在插件 iframe 根节点写入 `data-qx-raycast-action-panel`，让转换插件可按宿主偏好渲染。
- Raycast generic shim 默认将 `ActionPanel` 渲染为条目右侧紧凑按钮；用户关闭偏好或插件面板左右缩窄时优先隐藏按钮，保留列表文本/缩略图空间。
- Raycast `Detail` shim 会渲染 `props.actions`，详情型扩展可继续提供复制、切换和设置入口。
- 转换器支持安装扩展生产 npm 依赖（禁用 lifecycle scripts），并强制 React / React DOM 解析到 Qx converter 依赖，避免扩展目录依赖带来双 React hooks 错误。
- Raycast preferences 映射到 Qx manifest preferences：dropdown -> select、checkbox -> boolean、password -> password、文本类 -> string。
- 主仓与 `qx-plugins` 转换器已同步该协议，`raycast-bing-wallpaper` 已重新转换并重新打包。
- 验证 Raycast `calendar`（commit `186d955eda64f9e956b25a3fdf5566b1d38f57f2`）：依赖 `calendar` / `weeknumber`，转换为 `raycast-calendar` 后可显示日历、切换月份、复制当前视图，并带 3 个 preferences 与 2 张截图。
- 更新 `README.md`、`public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md`、`public/doc/raycast-plugin-conversion.md` 和 `qx-plugins` README。

### 验证

- [x] `node --check scripts/convert-raycast-extension.mjs`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] Native control scan：仅命中 Markdown 内容样式 `src/styles/qx-ai.css:.qx-md-body li input[type="checkbox"]`，非产品控件。
- [x] `qx-plugins`：`node --check scripts/convert-raycast-extension.mjs`、`node --check src/raycast-bing-wallpaper/index.js`、`unzip -t raycast-bing-wallpaper.qx-plugin`。
- [x] `qx-plugins` Bing Wallpaper happy-dom 抽样：`context.display.raycastActionPanel=false` 时 15 个 ActionPanel 均带 `is-hidden`，动作按钮仍存在。
- [x] `qx-plugins` Calendar：`node --check src/raycast-calendar/index.js`、`unzip -t raycast-calendar.qx-plugin`。
- [x] `qx-plugins` Calendar happy-dom 抽样：显示 `# July 2026`，点击 `Next Month` 后变成 `# August 2026`，`Copy` 写入 clipboard bridge 且内容匹配当前视图。
- [x] 本机安装 `raycast-calendar.qx-plugin` 到 `~/.qx/plugins/raycast-calendar`，manifest、`index.js` 语法、`.enabled`、1 个命令、3 个 preferences、2 张截图验证通过。
- [ ] 手动验证：Settings -> Extensions -> Installed -> Display 开关保存；Bing Wallpaper 在宽面板显示动作按钮，窄面板先隐藏；关闭开关后重新打开插件不显示动作按钮。

## Feature — 应用内自动更新与 helper 覆盖安装

**状态**：已实现，已通过本地验证。

### 新增内容

- 新增自定义 updater 后端命令 `qx_update_check` / `qx_update_download_and_install`，读取 GitHub latest release，优先使用 release asset `latest.json`，fallback 到 ARM64 `.app.zip` asset。
- Release workflow 生成并上传 `latest.json`，包含版本、ARM64 zip URL、SHA256 和 size；应用只有在 SHA256 可用、当前运行于 `.app` bundle、目标为 macOS ARM64 时才允许自动安装。
- 下载流程写入 `~/.qx/cache/updates/<version>/`，流式计算 SHA256，校验 size，然后用 `/usr/bin/ditto -x -k` 解压 staging app。
- 安装流程复制当前可执行文件为临时 helper；主进程退出后 helper 等待 PID 消失，用 `ditto` 替换 `Qx.app`，清理 `com.apple.quarantine` xattr，确认主二进制可执行，并通过 `/usr/bin/open` 重启。
- Settings -> General 的 `auto_update` 会在启动后后台检查并自动下载安装可安装版本；About 页面支持手动检查和 `Download & Install`。
- 移除旧 `tauri-plugin-updater` 前端包、Rust 插件依赖、Tauri 插件配置和 ACL，避免继续走 `plugin:updater|check`。
- 更新 `docs/release-and-versioning.md`、`docs/technical-architecture.md`、`public/doc/release-workflow.md` 记录 helper updater 与 `latest.json` 要求。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `cargo test updater::tests -- --nocapture`（6 个 updater 单测：版本比较、SHA256 digest、asset 解析、下载校验 staging、helper launch 准备、bundle 覆盖替换）
- [x] `npm run tauri -- build --target aarch64-apple-darwin --bundles app`
- [x] 本地模拟 release workflow `latest.json` 生成并用 Node 解析校验字段。
- [x] 旧 updater 残留扫描无命中：`tauri-plugin-updater` / `@tauri-apps/plugin-updater` / `plugin:updater` / `updater:allow-check`。
- [x] Native control scan 仅命中 Markdown 内容样式：`src/styles/qx-ai.css:.qx-md-body li input[type="checkbox"]`，非产品控件。
- [ ] 线上 GitHub latest release API 确认：当前环境 unauthenticated `curl` 返回 403，无法从本机确认当前 release assets。下一次发布后需确认 GitHub Release 同时包含 ARM64 `.app.zip` 和 `latest.json`。

## Feature — 插件缓存存储与天气秒开

**状态**：已实现，等待验证。

### 新增内容

- 天气后端新增 `get_cached_weather`，成功拉取天气后写入 `~/.qx/cache/weather-cache.json`；缓存按 provider、location override、API key 匹配，设置变化后不会误用旧数据。
- 天气面板打开时先读取缓存并立即渲染，再静默刷新实时天气；无缓存时保留原 loading/retry 流程。
- 插件 SDK 新增 `context.storage.session.*` 进程内临时 KV 和 `context.storage.persist.*` 长期 KV；旧 `context.storage.get/set/delete` 保持为持久存储兼容别名。
- Raycast 转换生成的 System Information / System Monitor 面板改成非阻塞首屏：先同步显示 loading，再异步填充系统数据，避免插件 Host 等待系统命令完成。
- 已检查其他现有模块：RSS、Clipboard、Screencap 主要读本地历史；V2EX 和 GitHub Calendar 是网络型但在组件内显示 loading/skeleton，不会阻塞插件 Host。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证：首次打开天气无缓存时显示 loading；成功后再次打开天气立即显示旧数据并后台刷新；转换后的系统信息/监控插件打开不再等待数据请求完成。

## Bugfix — Raycast 转换器未适配扩展稳定性

**状态**：进行中，已完成 CLI 通用 shim 原型。

### 修复内容

- 验证 Raycast `bing-wallpaper`（commit `870667fc671801a467deb7c4c7fc72992efe3820`）：它依赖 `@raycast/api` React view、Node fetch/fs 下载、AppleScript 设置壁纸和 Raycast background command runtime。
- CLI 转换器新增 generic Raycast shim：使用 esbuild 打包 Raycast TS/TSX command，虚拟替换 `@raycast/api`、`node-fetch`、`file-url`、`fs-extra`、`run-applescript`、`os`、`path`、`buffer`。
- Shim 覆盖 `List` / `Grid` / `Detail` / `ActionPanel` / `Action` / `Toast` / `showToast` / `showHUD` / `LocalStorage` / `Cache` / `getPreferenceValues` / `open` / `showInFinder` / `Clipboard` / `useNavigation` 等常用 Raycast API。
- `bing-wallpaper` 通过 CLI 转换后生成 `raycast-bing-wallpaper.qx-plugin`：manifest 保留 3 个 Raycast commands，`index.js` 为 bundled runtime，不再是 placeholder。
- 转换器会复制 Raycast 图标资源，并自动识别 `screenshots` / `media` / `gallery` / `metadata/` 图片写入 manifest；Settings -> Plugins Installed 列表和详情页可显示插件图标与截图。
- Raycast 转换产物新增 `platforms` 与 `raycast.platformCompatibility` 兼容报告；CLI 会静态分析 Raycast UI、HTTP、Clipboard、LocalStorage/Cache、fs-extra、showInFinder、run-applescript、no-view interval 和 menu bar command，Installed 详情页显示 macOS / Windows 的 Supported、Partial 或 Unsupported 状态，以及可用/降级/不可用能力。
- 转换产物保留 `mode` / `interval`，Qx 插件 registry 根据 no-view command interval 做持久化后台调度；next run 写入 `localStorage`，插件重载或 Qx 重启后恢复。
- 新增 `plugin_run_applescript` 后端命令，generic shim 的 `run-applescript` 可通过精确权限 `invoke:plugin_run_applescript` 走真实 `osascript`。
- 新增 `plugin_file_read_base64` / `plugin_file_exists` / `plugin_file_ensure_dir` / `plugin_file_write_base64` / `plugin_file_empty_dir` / `plugin_file_list` 后端命令，generic shim 的 `fs-extra` 可访问真实文件路径、`~/...` 和虚拟私有路径 `/qx-plugin-files/<id>`；`/qx-home` 会映射到真实用户 Home，AppleScript 执行前也会替换为真实路径。
- app 内 `install_raycast_extension_from_url` 对 generic 扩展优先调用同一套 JS converter：临时 sparse clone Raycast 源码、bundle/package 后再用现有 `.qx-plugin` 安装路径落地。
- CLI 转换器同步 System Information / System Monitor 非阻塞首屏行为，与 app 内转换模板保持一致。
- 已知剩余：打包分发版需要随 app 提供 JS converter pipeline；generic shim 的同步文件读取只能覆盖当前运行内存中写过的文件，跨进程真实文件读取需要使用异步 `readFile/readJson/pathExists`；本机 UI 自动化受 AppleEvent/进程查询限制，尚未完成可视化点击验证。

### 验证

- [x] `node --check scripts/convert-raycast-extension.mjs`
- [x] `node scripts/convert-raycast-extension.mjs /private/tmp/qx-raycast-bing/extensions/extensions/bing-wallpaper --out /private/tmp/qx-raycast-bing/qx-generic --package`
- [x] `node --check /private/tmp/qx-raycast-bing/qx-generic/raycast-bing-wallpaper/index.js`
- [x] 产物检查：`raycast-bing-wallpaper.qx-plugin` 带 3 张 Raycast metadata 截图后约 11 MB；bundled `index.js` 约 637 KB；包含 `HPImageArchive`、`plugin_run_applescript`、`plugin_file_read_base64`、`/qx-home`、`qx-raycast-grid`、截图资源和 no-view interval metadata。
- [x] `cargo test marketplace::tests -- --nocapture`（`src-tauri/`，含 generic manifest 测试）
- [x] `npx tsc --noEmit`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `npm run build`
- [x] 安装转换出的 `/private/tmp/qx-raycast-bing/qx-generic/raycast-bing-wallpaper.qx-plugin` 到 `~/.qx/plugins/raycast-bing-wallpaper`，真实安装目录 manifest、图标、3 张截图资源和 `index.js` 语法检查通过。
- [ ] UI 点击验证：打开 Bing Wallpaper 面板显示 Bing 图片、Action 能下载/设置壁纸、no-view interval 可恢复。

## Feature — 应用搜索中文名与拼音匹配

**状态**：已实现，等待手动验证。

### 新增内容

- `apps::AppEntry` 新增 `display_name` 字段并下发前端，优先取 `zh-Hans.lproj` / `zh_CN.lproj` / `Chinese.lproj` 中的 `CFBundleDisplayName`。
- 新增 `apps_zh_dict.rs`，内置 Apple 系统应用（访达、应用商店、系统设置、邮件、终端、活动监视器等约 60 项）的中文展示名与别名，按 `CFBundleIdentifier` 索引。
- `localized_bundle_aliases` 改为 `resolve_localized_names`，同时返回 `(display_name, aliases)`；扫描时把所有中文别名（含字典）转成全拼与首字母写入 `aliases`，让用户用 `weixin` / `wx` 也能命中。
- `search_apps` 评分新增 `display_name` 的 exact / starts_with / contains 三档，与 `name` 等权重；`aliases` 仍按原顺序兜底，命中拼音和 Apple 系统 app 中文名。
- 引入 Rust `pinyin = "0.10"` crate（轻量、纯 Rust，无 native 依赖）。
- 前端 `AppEntry` 类型新增可选 `display_name`，新增 `src/search/appDisplay.ts` 暴露 `useDisplayName()`；`ResultsList` 与 `LauncherContext` 在 `general.language === "zh-CN"` 时优先渲染中文名。
- `apps` 表 schema 新增 `display_name` 列并通过 `ALTER TABLE` 安全升级旧 DB。
- `UI_SPEC.md` 新增 "Application Naming" 节，明确 `name` / `display_name` / `aliases` 的语义与优先级。

### 验证

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `cargo fmt --check`（`src-tauri/`）
- [ ] `cargo check`（`src-tauri/`）
- [ ] 手动验证：在 Launcher 输入"微信"命中 WeChat.app；输入"应用商店"命中 App Store；输入"访达"命中 Finder；输入 `weixin` / `wx` 命中微信；切换语言为英文时列表显示英文名。

---

## Feature — Launcher 搜索别名与标签

**状态**：已实现，等待验证。

### 新增内容

- Settings 持久化新增 `search_metadata`，按 `app:<path>`、`plugin:<id>`、`module:<id>` 保存用户自定义 aliases 和 tags。
- Launcher 右侧 Context Panel 在选中应用或模块时可直接编辑别名/标签，使用 Qx shadcn `Input` / `Button` / `Badge`。
- Extensions → Installed 详情页新增 Search Aliases & Tags，可为内置模块和外部插件配置搜索别名/标签。
- Launcher 搜索现在会匹配应用别名/标签、插件/模块别名/标签；别名命中应用时会补入真实应用结果。
- Installed 插件列表搜索会匹配别名/标签，便于按用户自定义分类查找插件。

### 验证

- [x] `npx tsc --noEmit`
- [x] `rg '<select|type="range"|type="checkbox"|type="radio"' src`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证给应用、内置模块和外部插件添加 aliases/tags 后，Launcher 和 Installed 搜索均可命中。

---

## Feature — 灵动岛 LED 点阵时间显示

**状态**：已实现，已通过静态验证。

### 新增内容

- 新增 `src/components/Matrix.tsx`，移植 unlumen UI 的 LED 点阵 Matrix 组件（SVG 像素 + 辉光 + 帧动画 + VU 表），渐变/滤镜 id 用 `React.useId()` 做唯一前缀避免多实例冲突。
- `HomeDateIsland.tsx` 改用 Matrix 渲染 `HH:MM` 时间点阵：通过 `digits` 字模拼接 H H : M M 为 24×7 单 Frame，冒号按秒奇偶闪烁；公历/农历日期继续保留为右侧滚动副本。
- 灵动岛调色板使用 Qx 既有变量（`--qx-system-island-text` / `--qx-system-island-muted`），不引入新色值。
- 新增 `.qx-date-matrix` 样式收缩点阵与日期副本间距。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] 手动验证设置 → 日期显示模式下灵动岛显示点阵时间，冒号秒级闪烁，公历/农历滚动正常。

---

## Feature — AI Agent 设置模块与工具门控

**状态**：已实现，等待验证。

### 新增内容

- Settings 新增独立 `AI Agent` 模块，支持开启 Agent 模式。
- Agent 设置可配置默认 provider/model，并同步 QxAI 当前模型选择。
- Agent 设置可配置模型工具调用标记、工具总开关、memory/app search/file search/http/notification/MCP/background task 等工具组。
- Agent 设置可配置 bash 工具开关、默认 cwd 和超时上限。
- Agent 设置可配置真实 `rg` / `grep` 文本搜索接入、默认搜索根目录和结果数量上限。
- Rust settings schema 新增 `agent` 持久化分支，支持设置导入/导出。
- 插件 AI runtime 新增 `context.ai.agentSettings()` 和 `context.ai.search.grep()`。
- `plugin_ai_run_bash` 与新增 `plugin_ai_grep_search` 会读取 Settings -> AI Agent 的全局开关进行门控。
- 更新 `docs/ai-agent-runtime.md`、`public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md` 和 `docs/technical-architecture.md`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证 Settings -> AI Agent 中开关、provider/model、bash、grep 配置能保存并在插件调用时生效。

---

## Bugfix — 界面透明度一致性

**状态**：已实现，已通过本地验证。

### 修复内容

- 透明度设置从单一 `--qx-canvas-opacity` 扩展为语义变量：窗口底色、Shell 区域叠层、Elevated/Glass 区域、Overlay Bottom、Popover/Bottom Island。
- 组件表面色 `--qx-bg-component-1/2/3` 改为 RGB + 透明度派生变量，列表、按钮、卡片、选择器等控件跟随同一个透明度设置。
- QxShell 根背景改为透明，由外层画布承载统一透明度，Top Bar / Context Panel / Bottom Bar / 灵动岛使用同一组透明度派生变量。
- 移除 Clipboard 模块对 QxShell 根背景的私有不透明覆盖，遵循 Shell 背景语义由统一样式控制。
- 外观设置文案从“画布透明度”调整为“界面透明度”，明确统一控制主壳、面板和灵动岛。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] 运行态 computed style 验证：`.qx-canvas` 使用 `--qx-window-opacity`，`.qx-shell-topbar` / `.qx-shell-context` / `.qx-shell-bottombar` 使用同一 `--qx-shell-region-opacity`，`.qx-bottom-island` 使用 `--qx-shell-popover-opacity`，`.qx-shell-action` 跟随 `--qx-bg-component-3` 的 surface opacity。

---

## Feature — AI 插件底层能力与多模态模型目录

**状态**：已实现，等待验证。

### 新增内容

- 新增插件 `context.ai` SDK：`providers()`、`models(provider?)`、`defaultModel()`、`chat(input, options?)`。
- 新增 `ai` 插件权限，插件声明后可调用 QxAI 文本和图片多模态能力。
- 自定义 OpenAI-compatible provider 的模型目录优先通过真实 API `GET /models` 获取，失败时回退到本地缓存/手填模型。
- QxAI 设置页自定义 provider 支持 `Fetch Models`，可从 API 拉取模型列表。
- 插件 AI 调用支持字符串 prompt、messages 数组、OpenAI-compatible content parts，以及 `images` 便捷参数。
- 插件 AI 新增 `context.ai.stream()`，以 chunk 回调方式支持流式文字输出。
- 后端多模态消息以 JSON content 透传给自定义 provider；DuckDuckGo 文本 provider 遇到图片输入时返回明确错误。
- 插件 AI 新增真实 bash 子进程工具 `context.ai.runBash()`，使用 `ai-bash` 独立权限和超时保护。
- 插件 AI 新增用户记忆接口 `context.ai.memory.*`，使用 `ai-memory` 独立权限，当前持久化到 `~/.qx/qxai-memory.json`。
- QxAI Settings 新增 Memory 管理区，用户可直接新增、刷新、删除持久记忆。
- 插件 AI 新增进程内后台任务接口 `context.ai.tasks.*`，使用 `ai-background` 独立权限，任务可在 Qx 隐藏到托盘后继续运行并在完成/失败时通知。
- 新增 `docs/ai-agent-runtime.md`，定义 ReAct、tool calling、MCP、memory、soul 和更持久后台任务的后续 runtime 边界。
- 更新 `public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md` 和 `docs/technical-architecture.md`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证插件声明 `ai` 权限后列模型、选择模型、文本调用、图片调用、stream chunk、后台任务、bash、memory 和缺权限报错。

---

## Bugfix — QxAI 输出与模型选择修复

**状态**：已实现，已通过本地验证。

### 修复内容

- QxAI 新会话创建时会从已加载 provider 列表中解析有效 provider/model，避免 provider 尚未加载完导致空配置会话。
- 发送消息前会再次校验并补齐会话 provider/model；缺失或异常时通过 QxShell 底部灵动岛显示错误。
- 聊天页右侧 Context Panel 新增当前会话 provider/model 选择，可直接切换已有会话模型。
- 修正自定义 OpenAI-compatible provider 的 Tauri invoke 参数名，确保真实请求能带上 `baseUrl/apiKey/model/messages`。
- DuckDuckGo provider 会将 `system` prompt 合并进首条 user 消息，并忽略 SSE 中非正文事件，避免接口格式导致空输出或异常正文。
- 通用 Select 支持 disabled 选项，QxAI provider 分隔项不再可被键盘或鼠标选中。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证内置 DuckDuckGo 输出、自定义 provider 输出、已有会话切换模型和异常灵动岛报错。

---

## Bugfix — 插件异常隔离与灵动岛报错

**状态**：已实现，已通过静态验证。

### 修复内容

- 插件加载改为非阻塞异步落地：先显示已安装插件列表和内置能力，再并发加载外部插件命令/面板。
- 单个插件加载失败、快捷键注册失败、命令运行失败不再影响其他插件加载。
- 插件加载、成功和失败状态通过统一 runtime status hook 汇报到 Launcher 灵动岛。
- Launcher 当前搜索时，插件命令/面板异步加载完成后会自动刷新搜索结果。
- 插件面板 render/loading/timeout/error 状态接入插件页自己的底部灵动岛，错误时显示 Retry。
- 增加 load token，避免刷新/启停插件时旧异步加载结果污染当前 registry。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证坏插件 entry、坏 panel render、慢插件加载、命令异常时 Qx 可正常打开且灵动岛显示错误。

---

## Maintenance — 插件库 UI 与文档更新

**状态**：已实现，已通过前端静态验证。

### 优化内容

- Extensions → Installed 新增已安装插件搜索，以及 `All / Built-in / External / Enabled / Disabled` 筛选。
- Installed 和 Browse 统一为左侧列表 + 右侧详情结构，便于查看插件权限、preferences、版本、作者、大小、更新时间和 SHA256。
- Browse 市场安装增加安装中、已安装、失败状态反馈。
- 插件管理按钮补充 lucide 图标，样式收敛到 `settings-actions.css` 的插件库类名。
- 更新 `public/doc/plugin-marketplace.md`、`public/doc/plugin-system.md`、`docs/technical-architecture.md` 和 `README.md` 中的插件库说明。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证 Installed 搜索/筛选、Browse 搜索/详情、安装状态和右侧插件详情。

---

## Feature — Raycast system-information 转换适配

**状态**：进行中，已通过静态验证。

### 新增内容

- 新增 `scripts/convert-raycast-extension.mjs`，可将 Raycast 扩展目录转换为 Qx 插件目录，并可打包为 `.qx-plugin`。
- 插件管理器新增 Raycast extension URL 安装入口，可直接粘贴 GitHub Raycast extension tree URL 触发转换安装。
- 针对 Raycast `system-information` 扩展生成 Qx 插件适配层，保留 `View System Information` 面板和 `check-storage / check-system-info / check-network / list-processes / kill-process` 命令。
- 新增后端真实系统信息命令：系统信息、存储、网络、进程列表、结束进程。
- 插件 RPC 权限检查同时支持精确命令名和 `invoke:<cmd>` 写法。
- 新增 `public/doc/raycast-plugin-conversion.md` 记录 Raycast 兼容边界和转换流程。

### 验证

- [x] `node scripts/convert-raycast-extension.mjs /tmp/qx-raycast-sparse/extensions/system-information --out /tmp/qx-raycast-converted --package`
- [x] `node --check scripts/convert-raycast-extension.mjs`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo test marketplace::tests -- --nocapture`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] 安装转换后的 `.qx-plugin` 到 `~/.qx/plugins/raycast-system-information` 并启用。
- [x] 用已安装插件入口执行 6 个命令和面板渲染，验证 Hostname / Storage / Network / Running Processes 输出。
- [ ] 在 Qx UI 中手动验证搜索入口、面板展示和命令 toast。

---

## Bugfix — 窗口尺寸拖拽闪烁

**状态**：已实现，已通过本地构建验证。

### 修复内容

- `App.tsx` 启动恢复窗口尺寸只执行一次，不再依赖整个 `settings.appearance`，避免拖动窗口时 settings 回写触发 `setSize()`。
- `App.tsx` 的 resize 保存改为 250ms debounce，减少拖动时频繁保存和重渲染。
- `AppearanceSettings.tsx` 移除重复的 `onResized` 监听和自动 `set_window_size` effect，外观页只在用户提交 W/H 输入时主动调整窗口。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `npm run tauri build`
- [x] 本地替换 `/Applications/Qx.app` 并启动。

---

## Maintenance — QxShell / Launcher 结构整理

**状态**：已实现，已通过静态验证。

### 整理内容

- 将 `QxShell.tsx` 中的底部灵动岛渲染拆到 `QxBottomIsland.tsx`，并保留 `BottomIslandContent` 类型从 `QxShell` re-export，避免影响现有模块 import。
- 将 Shell 底部动作按钮拆到 `ShellActionButton.tsx`，使 Shell 主文件只负责三层布局编排。
- 将 Launcher 的选中项动作生成、动作弹层、右侧 Context Panel、历史加载分别拆到 `src/launcher/` 下的小模块。
- 将 `.qx-shell-action` 与 Shell 响应式布局样式从 `launcher.css` 迁移到 `shell.css`，解除 Shell 公共 UI 对 Launcher 私有样式的依赖。
- 移除 Launcher Context 的内联 spacing style，改用 CSS class。
- 补充动作面板键盘索引 clamp，避免空动作列表时出现非法索引。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] 手动验证 Launcher 搜索、右侧入口、Recent、`Cmd+K` 动作面板、`Cmd+,` 设置入口和底部动作按钮行为保持一致。

---

## Bugfix — 外观设置控件与窗口尺寸同步

**状态**：已实现，已通过静态验证。

### 修复内容

- 外观页 `W/H` 宽高输入改为输入草稿，失焦或回车后提交，避免半截数字触发窗口跳动。
- 接入 Tauri `onResized`，用户手动拖拽窗口后会回写 `appearance.window_width/window_height` 并同步显示到设置页。
- 设置保存改为乐观更新，避免旧的 `update_settings` 响应覆盖较新的本地状态。
- 圆角设置收敛到规范内的 `4px / 6px / 8px`，并让 `--qx-control-radius`、`--qx-card-radius` 跟随设置生效。

### 验证

- [x] `npx tsc --noEmit`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证外观页宽高、圆角、字号点击与窗口拖拽尺寸同步。

---

## Bugfix — QxShell Top Bar 搜索样式统一

**状态**：已实现，已通过静态验证。

### 修复内容

- 明确 `UI_SPEC.md` 中 Shell Top Bar 搜索框实现约束：统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 将通用搜索框样式从 Launcher 特例提升为 Shell 通用样式。
- 截图模块搜索框不再复用 Clipboard 私有样式，改用 Shell 通用搜索样式。
- Top Bar 内 Select 控件高度统一到搜索框高度，保证首页右上角筛选与搜索框对齐。
- Shell 搜索槽强制搜索框填满可用宽度，修复设置页搜索框收缩/无统一外观的问题。
- 纯文本 Top Bar 状态（如 `Qx v...`）统一成 42px 高的右上状态控件。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证首页与截图模块 Top Bar 搜索框高度、圆角、边框、focus 态一致。

---

## Feature — 主页灵动岛日期显示

**状态**：已实现，已通过静态验证。

### 新增内容

- 主页灵动岛模式新增 `日期显示`，用点阵屏风格显示当前时间、公历日期和农历日期。
- 原 `系统` 模式文案改为 `系统信息`，保留 CPU / GPU / MEM 老样式监控。
- `UI_SPEC.md` 补充灵动岛可承载消息通知、动态进度、播放进度，以及主页空闲样式说明。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证设置页可切换 `默认 / 系统信息 / 日期显示`，主页空闲时日期岛正常显示并实时更新。

---

## Spec — QxShell 灵动岛协议

**状态**：已完成。

### 规范内容

- 在 `UI_SPEC.md` 中新增灵动岛内容协议，明确模块和插件默认使用 `QxShell island` prop。
- 定义 `label/detail/progress/tone/actionLabel/onAction` 的字段语义和使用边界。
- 定义 `idle / notice / progress / activity / playback / error` 标准状态类型。
- 定义多消息抢占优先级：进行中任务、错误、完成通知、模块空闲信息、主页空闲样式。
- 明确视觉约束：默认 32px、最大 36px、窗口居中、单行截断、插件不得直接改 Shell 核心样式。
- 补充滚动展示规范：内部横向滚动、渐隐遮罩、hover/focus 暂停、遵守减少动态效果。

---

## Feature — 灵动岛滚动展示

**状态**：已实现，已通过静态验证。

### 新增内容

- 新增通用 `qx-island-marquee` 滚动轨道，支持固定岛尺寸内连续横向滚动。
- 系统信息和日期显示主页灵动岛已接入滚动展示。
- 支持 hover/focus 暂停滚动，并在 `prefers-reduced-motion: reduce` 下关闭自动滚动。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证系统信息与日期显示灵动岛滚动连续、不改变 Bottom Bar 高度和居中位置。

---

## Bugfix — Launcher Top Bar 层级和局部快捷键

**状态**：已实现，已通过静态验证。

### 修复内容

- 保持 Launcher Top Bar 的搜索框 + 右侧范围筛选结构不变，仅提升 Top Bar 层级，保证下拉菜单展开时覆盖下方内容区。
- Launcher 打开并聚焦时，`Cmd+,` 进入设置，`Cmd+K` 打开/关闭当前选中项操作框。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证下拉菜单不会被右侧内容覆盖，`Cmd+,` 和 `Cmd+K` 只在 Launcher 内按预期生效。

---

## P1 — 主题系统（Vercel Geist 风格）

**概述**：参考 Vercel Geist Design System 重新设计 Qx 主题系统，支持亮色/暗色/跟随系统三种模式，提供统一的设计语言和 CSS 自定义属性架构。

### 设计原则（来自 Vercel Geist）

- **10 阶色阶**：每种颜色（Gray/Blue/Red/Amber/Green/Teal/Purple/Pink）定义 10 级色阶，1 最暗/10 最亮
- **高对比度 + 可访问性**：文本对比度不低于 WCAG AA
- **毛玻璃保留**：Qx 特有的半透明毛玻璃效果叠加在 Geist 纯色系统之上
- **Grid 背景元素**：Vercel 标志性的网格背景图案
- **组件色语义**：背景(3级) + 边框(3级) + 高对比背景(2级) + 文字(2级)

### CSS 自定义属性架构

```css
/* ====== 亮色主题 (Light) ====== */
[data-theme="light"] {
  /* 背景 */
  --qx-bg-100: #fafafa;        /* 默认页面背景 */
  --qx-bg-200: #ffffff;        /* 组件卡片背景 */

  /* Gray 色阶 (从深到浅，1=最深, 10=最浅) */
  --qx-gray-100: #0a0a0a;
  --qx-gray-200: #1a1a1a;
  --qx-gray-300: #2e2e2e;
  --qx-gray-400: #404040;
  --qx-gray-500: #6b6b6b;
  --qx-gray-600: #8a8a8a;
  --qx-gray-700: #a0a0a0;
  --qx-gray-800: #b0b0b0;
  --qx-gray-900: #d4d4d4;
  --qx-gray-1000: #ededed;

  /* Blue 主色 (Accent) */
  --qx-blue-600: #2563eb;      /* 默认 accent */
  --qx-blue-700: #1d4ed8;      /* hover accent */
  --qx-blue-900: #60a5fa;      /* 高亮文字 */
  --qx-blue-1000: #eff6ff;     /* 浅蓝背景 */

  /* 组件色语义 */
  --qx-bg-component-1: #ffffff;      /* 默认组件背景 */
  --qx-bg-component-2: #f5f5f5;      /* hover 背景 */
  --qx-bg-component-3: #e8e8e8;      /* active 背景 */
  --qx-border-1: #e5e5e5;           /* 默认边框 */
  --qx-border-2: #d4d4d4;           /* hover 边框 */
  --qx-border-3: #a3a3a3;           /* active 边框 */
  --qx-text-primary: #0a0a0a;       /* 主要文字 */
  --qx-text-secondary: #6b6b6b;     /* 次要文字 */
  --qx-text-tertiary: #a0a0a0;      /* 辅助文字 */

  /* 毛玻璃 */
  --qx-glass-bg: rgba(250, 250, 250, 0.75);
  --qx-glass-border: rgba(0, 0, 0, 0.06);
  --qx-glass-shadow: rgba(0, 0, 0, 0.04);
}

/* ====== 暗色主题 (Dark) ====== */
[data-theme="dark"] {
  --qx-bg-100: #0a0a0a;
  --qx-bg-200: #000000;

  --qx-gray-100: #1a1a1a;
  --qx-gray-200: #1f1f1f;
  --qx-gray-300: #292929;
  --qx-gray-400: #2e2e2e;
  --qx-gray-500: #454545;
  --qx-gray-600: #878787;
  --qx-gray-700: #8f8f8f;
  --qx-gray-800: #7d7d7d;
  --qx-gray-900: #a1a1a1;
  --qx-gray-1000: #ededed;

  --qx-blue-600: #3b82f6;
  --qx-blue-700: #60a5fa;
  --qx-blue-900: #93c5fd;
  --qx-blue-1000: #172554;

  --qx-bg-component-1: #1a1a1a;
  --qx-bg-component-2: #1f1f1f;
  --qx-bg-component-3: #292929;
  --qx-border-1: #292929;
  --qx-border-2: #333333;
  --qx-border-3: #454545;
  --qx-text-primary: #ededed;
  --qx-text-secondary: #878787;
  --qx-text-tertiary: #6b6b6b;

  --qx-glass-bg: rgba(10, 10, 10, 0.80);
  --qx-glass-border: rgba(255, 255, 255, 0.06);
  --qx-glass-shadow: rgba(0, 0, 0, 0.30);
}
```

### 字体系统

```css
--qx-font-sans: 'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--qx-font-mono: 'Geist Mono Variable', 'SF Mono', 'Fira Code', monospace;
```

Geist Variable 字体可通过 npm 包 `@vercel/geist-font` 安装，或使用系统备选。

### 网格背景（Grid Pattern）

Vercel 标志性设计元素：在全局设置面板的背景中叠加半透明网格图案。

```css
.qx-grid-bg {
  background-image:
    linear-gradient(rgba(128, 128, 128, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 128, 128, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
}
/* 暗色下透明度调整 */
[data-theme="dark"] .qx-grid-bg {
  background-image:
    linear-gradient(rgba(128, 128, 128, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 128, 128, 0.08) 1px, transparent 1px);
}
```

### 主题切换实现

**存储**：`~/.qx/settings.json` 中 `appearance.theme: 'light' | 'dark' | 'system'`

**CSS 变量方案**：
- `[data-theme="light"]` / `[data-theme="dark"]` 在 `<html>` 元素上切换
- `data-theme="system"` 时，用 JS 监听 `prefers-color-scheme` 媒体查询自动切换
- 所有组件引用 `var(--qx-*)` 而非硬编码颜色

**组件**：
- 新增 `ThemeProvider.tsx`（或 useTheme hook）管理 theme class + 系统偏好监听
- `AppearanceSettings.tsx` 中的主题 radio 接入实际切换逻辑
- 主题切换时应用 `transition: background-color 0.2s ease, color 0.2s ease`

### 改造范围

| 文件 | 改动 |
|------|------|
| `src/App.css` | 全部重写为 `var(--qx-*)` 变量引用 + grid 背景 |
| `src/App.tsx` | 包裹 `<ThemeProvider>`，主题切换监听 |
| `src/modules/settings/AppearanceSettings.tsx` | 主题 radio 接入实际切换逻辑 |
| `src/modules/settings/store.ts` | 主题状态持久化到 settings.json |
| 所有组件 CSS | 逐步替换硬编码颜色为 `var(--qx-*)` |

**渐进策略**：先在主面板/app.css 层实现完整变量系统，再逐步替换硬编码颜色。
