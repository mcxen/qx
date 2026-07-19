> Settings/About 面板的结构、设计令牌、Row/Card 规范与响应式断点见 [docs/settings-panel.md](docs/settings-panel.md)。

## Fix — Qx Bing Wallpaper Windows 原生壁纸端口

**状态**：代码与 Windows 安装包构建均已通过，等待 Windows 10/11 真实桌面运行态复核。

- 新增稳定的 `context.system.setWallpaper(path, { scope })` 插件端口；插件只提交已下载的
  本地图片路径，macOS / Windows 平台差异统一留在 Rust 系统适配层。
- Windows 不再由 Bing / Unsplash 各自拼 PowerShell + C#；宿主直接调用
  `SystemParametersInfoW(SPI_SETDESKWALLPAPER)`，检查 Win32 返回值并保留 UTF-16 路径，
  可明确报告系统策略、路径或 API 失败。
- macOS 既有 AppleScript 壁纸设置也迁入同一宿主端口；Bing 与 Unsplash 两个第一方消费方
  已同时迁移，移除重复实现和不必要的 `cli` / `plugin_run_applescript` 权限。
- `plugin_system` 从超过 1000 行的 `plugin_cli.rs` 中拆为独立领域模块，CLI 与系统能力不再
  混在同一个 Rust 文件；公开端口、权限、IPC 和模块清单文档同步更新。

### 验证

- [x] macOS `cargo check`；Win32 函数签名与 `windows-sys 0.59` 本地定义核对。
- [x] `npm run check` / `npm run build` / `cargo check` / `cargo test --lib`（84 tests）/
  Bing 2.0.2 与 Unsplash 1.1.1 重新打包并覆盖本机开发安装。
- [x] Windows Compatibility：run `29675005371`，MSVC target check + NSIS bundle +
  installer artifact upload 均通过。
- [ ] Windows 10/11：Bing Gallery 的 Set、Random、Latest 三条入口均能换壁纸；中文/空格
  用户目录可用，失败时显示 Win32 错误而不是静默成功。

## Bugfix — Windows 文件与文件夹剪贴板完整链路

**状态**：代码与跨平台协议已修复，等待 Windows Explorer / RDP 运行态复核。

- Windows 原生读取从剪贴板核心拆到 `clipboard/native.rs`，一次枚举完整 `CF_HDROP`
  文件列表并保留 UTF-16、UNC、空格与非 ASCII 路径；捕获时不再用 `exists()` 丢弃
  重定向盘或暂时不可访问路径，文件夹由真实文件系统类型写入 `file_kind`。
- 监听改为 250ms、当前剪贴板立即首读，并以 `CaptureCursor` 在读取/入库成功后才提交
  `GetClipboardSequenceNumber`；Explorer、RDP 或安全软件短暂占用剪贴板时，同一个复制
  事件会继续重试，不再失败一次后永久跳过。
- 数据库新增兼容性 `file_paths` JSON 列；单文件保留原 ID 与 `file_path`，多选文件作为
  一个有序历史项保存，前端显示首项与数量、搜索覆盖全部路径，重新复制时整体写回
  Windows `CF_HDROP` / macOS 文件列表，并在使用时逐项验证是否仍存在。
- 剪贴板核心已降到 1000 行以内；平台读取、重试游标、file-list 领域规则分别收口，
  没有在前端或各命令重复解析 Win32 数据。

### 验证

- [x] `npx tsc --noEmit`、`npm run check` / `npm run build`、`cargo fmt --check`、
  `cargo check`、`cargo test --lib`（82 tests，其中剪贴板定向 7 tests）。
- [x] Windows Compatibility：run `29674203293`，MSVC target check + NSIS bundle 均通过。
- [ ] Windows 10/11/RDP：Explorer 分别复制文件、文件夹、多选、中文/空格路径、UNC 或
  重定向盘路径；Qx 在 1 秒内显示，关闭 Qx 后粘贴到 Explorer 仍保留完整列表。

## Bugfix — Windows 主窗口黑边与 Everything 后台搜索

**状态**：已完成代码修复，等待 Windows 安装包运行态复核。

- Windows 透明无边框主窗口关闭 DWM undecorated shadow，避免 Windows 10、远程桌面
  和部分显卡环境出现右侧/底部不透明矩形黑边；Qx 语义边框和内高光继续保留。
- Qx 随包 Everything 改用 `%LOCALAPPDATA%/Qx/search/Everything-Qx.ini` 私有配置，固定
  后台运行、隐藏托盘、禁用启动更新检查且不请求管理员模式；移除会进入安装配置语义的
  `-app-data`，不再把 Everything 搜索界面带到前台。
- Qx 启动后主动探测命名实例 `Qx` 的 ES IPC；查询增加 1.5 秒 IPC timeout，成功的空结果
  也会确认实例已就绪，缺少二进制、进程启动失败和 IPC 失败写入一次结构化诊断，避免
  Launcher 只显示“未找到结果”却没有可定位原因。

### 验证

- [x] `npm run check` / `npm run build` / `cargo fmt --check` / `cargo check` /
  `cargo test --lib`（76 tests）。
- [x] Windows Compatibility：run `29674203293`，MSVC target check 与真实 NSIS bundle 均通过。
- [ ] Windows 10/11/RDP：窗口无矩形黑边；任务管理器可见 Qx 私有 Everything 后台进程，
  但没有搜索窗口、控制台或托盘图标；All / Files 输入短词和中文文件名均能返回结果。

## Bugfix — Windows RSS 旧数据库升级顺序

**状态**：已修复，等待 Windows 旧库运行态复核。

- RSS schema 迁移改为事务内先创建基础表、再为旧 `rss_feeds` / `rss_articles` 补齐
  `folder_id` / `reading_progress`，最后创建依赖索引，避免旧库启动时
  `idx_feeds_folder` 提前引用不存在的列。
- 新增 legacy schema 回归测试，覆盖旧数据保留、缺失列补齐、索引创建和重复迁移幂等。

### 验证

- [x] `cargo fmt --check`
- [x] RSS storage 单元测试 + `cargo test --lib`（76 tests）+ `cargo check` + `npm run check`
- [ ] Windows 使用报错旧 `rss.db` 启动并确认订阅、文章和目录保留。

## Fix — Windows 安装文件锁与主界面启动兼容性

**状态**：已完成代码修复，等待 Windows 安装/升级运行态复核。

- NSIS 升级先退出 Qx 命名实例、停止并移除 Qx 专属 Everything 服务，再轮询
  `resources/search/everything.exe` 写权限最多 65 秒；日志解释 Windows 服务释放文件
  可能延迟，超时则给出明确原因并安全中止，不影响用户单独安装的 Everything。
- Windows 默认窗口召唤改为 `Ctrl+Alt+Space`，避开系统窗口菜单和 PowerToys Run 常用的
  `Alt+Space`；未修改的旧 Windows 出厂绑定会迁移，自定义绑定保持不变。
- 单个全局快捷键被占用时不再中止 Tauri `setup`，Qx 仍会创建托盘和首启界面；设置
  保存路径仍返回注册错误，方便用户更换按键。
- 主窗口每次 `show + focus` 都在 Rust 原生窗口层获得 500ms 防失焦保护，吸收
  Windows WebView2 首次显示时的瞬时 `Focused(false)`，避免刚出现就被自动隐藏。
- Windows 不再把含原生 `HMONITOR` 的 `xcap::Monitor` 放进全局静态缓存，修复
  `v0.5.43` Windows Release 的 `Send` / `Sync` 编译失败。
- `Windows Compatibility` 在 `main` push 时也执行 Windows target check 与真实 NSIS
  bundle，避免只在打 release tag 后才发现平台编译错误。

### 验证

- [x] `npm run check` / `npm run build`。
- [x] `cargo fmt --check` / macOS `cargo check` / `cargo test --lib`（75 tests）。
- [ ] `cargo check --target x86_64-pc-windows-msvc` 与 Windows NSIS bundle build。
- [ ] Windows：覆盖安装时等待旧搜索服务释放；安装完成后首启、托盘和
  `Ctrl+Alt+Space` 均可打开主界面；开启 PowerToys Run 时仍正常。

## Feature — QxIsland 动态显示、加载动画、按钮与浮窗打开协议

**状态**：已完成代码与协议收口，等待桌面运行态视觉复核。

- 在既有 `islandHost + IslandSession + QxIslandSurface` 上形成类似 Workbench 的稳定
  结构化端口，不新增平行灵动岛实现。
- 不确定进度由宿主统一绘制 `wave / dots / spinner / pulse` 四套动画；旧
  `bounce / bounce-exit` 已从公开类型和 renderer 移除，winner 切换有短过渡，普通进度更新不重复入场。
- `IslandActionButton` 统一业务按钮的尺寸、受限图标、危险态、焦点与异步防重复点击；
  插件仍最多一个 action，模块最多两个。
- session 新增 host-owned `openTarget`；插件 bridge 固定回当前插件 Panel，旧 session
  无目标时仅显示主窗作为安全回退。
- slots 岛左侧新增宿主统一的圆角矩形模块图标；内置模块从稳定 `islandKey` 绑定目标，
  插件使用宿主已解析图标资产并沿用可信 `openTarget`，docked / floating 点击均可快速打开发布模块。
- 前台非粘性 `location` 优先于后台粘性轮播，RSS 阅读进度不再被番茄时钟周期替换；
  离开 RSS 后番茄常驻 session 自动恢复。
- 暂停 countdown 由宿主强制抑制 activity，旧插件即使误传 `pulse` 也不会继续播放加载动画。
- 桌面浮窗改为用户显式生命周期：只能从 Qx 底部灵动岛手动浮出，浮窗关闭后清除
  本次意图，计时或 session 更新不会自动重新弹出。
- 市场 `pomodoro-island` 1.6.0 作为首个接入样板：运行态 `pulse + endsAt`、暂停态
  冻结倒计时、完成态真实 100%，已打包并覆盖本机开发安装。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [ ] macOS / Windows：四套 activity、reduced motion、按钮 busy、浮窗回插件 Panel。

## Feature — Qx 桌面悬浮灵动岛轮播与事件抢占

**状态**：已完成代码实现，等待 macOS / Windows 桌面运行态复核。

- 悬浮灵动岛改为 Qx 级开关与手动浮出策略；番茄钟等插件只发布结构化状态和动作，
  不能自动弹出窗口。
- 首次默认锚定主显示器工作区右上角，不抢焦点；浮出后可从内容区拖到任意显示器，
  坐标持久化并在隐藏/显示、缩小/展开和重启后恢复；macOS 可跨 Space 保持置顶。
- 普通模块 / 插件 `location` session 按 5 / 8 / 15 秒可选间隔轮播；task、error、toast 严格抢占，结束后恢复轮播。
- 浮窗从 Qx appearance 同步主题、透明度、圆角和字号，与 docked 灵动岛使用同一 Surface chrome。
- Docked Surface 提供宿主“悬浮到桌面”按钮；悬浮 Surface 提供缩小 / 展开、打开 Qx
  与关闭按钮。缩小后真实窗口收至 240px，番茄钟等插件无需自绘窗口控制。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [x] `cargo fmt --check` / `cargo check`
- [ ] macOS：主屏右上、多 Space、不抢当前输入焦点、番茄钟暂停动作与多插件轮播。
- [ ] Windows：主屏工作区右上、任务栏避让、always-on-top 与前台输入焦点。

## Fix — Workbench 稀疏 List / Gallery 稳定画布

**状态**：已完成宿主修复，等待插件运行态视觉复核。

- 空 List 继续保留左侧列表轨、右边界和详情区，不因零条或少量条目视觉消失。
- 空 Gallery 的空态跨满整个画布，不再只占第一个网格单元；少量卡片时仍显示完整 Gallery 表面。
- 修复位于宿主 Workbench 端口，所有声明式插件共享，不要求插件各自补 CSS。
- Workbench List 空载与刷新状态改用 V2EX 同款宿主协议：左栏 header/计数始终存在，首次加载显示 skeleton + LoadingLabel，已有数据刷新保持旧条目并显示 `…`。

## Fix — Search Settings ownership and Home System Island metrics

**状态**：已完成代码修复，等待本地运行态复核。

- 侧栏将原 `File Search` 显示名统一为 `Search Settings` / `搜索设置`，保留 `file-search` 内部 id 以兼容既有深链与快捷入口。
- 启动器模块搜索源设置迁移到 Search Settings，与文件分类设置集中维护；Appearance 只保留主题、布局和 Home Island 外观职责。
- Home System Island 去除重复 marquee 数据和 GPU 展示，保留 CPU / MEM 的异步采样与曲线。

### 验证

- [ ] macOS：浅色/深色设置页检查 Search Settings 入口、模块开关与底部 CPU/MEM 岛视觉。

## Feature — Screen Capture module settings and tray actions

**状态**：已完成代码实现，等待本地捕获流程复核。

- 截图/录屏设置统一进入 Settings → Extensions → Installed → Screen Capture，主模块提供直接跳转链接。
- 录屏格式、帧率、质量、分辨率、延迟、圈选确认、录制/截图后自动隐藏和自动复制到剪贴板均使用全局 `screencap` 设置。
- QxShell 操作菜单补充已启用的托盘操作；托盘操作在 Shortcuts 设置中拥有独立的全局快捷键绑定。
- 录屏文件使用原生文件剪贴板语义复制；截图继续使用图片剪贴板语义。

## Fix — Workbench 受控交互、List / Gallery 与插件事件协议

**状态**：已完成代码与协议审计，等待最终人工视觉复核。

- Workbench Top Bar 统一由 QxShell 组合 search + trailing tabs/background；插件不再自绘第二层顶栏。
- List 使用 Raycast 式三轨行布局；Gallery 使用宿主响应式网格。鼠标点击先在宿主即时选中，隐藏 iframe 退出 pointer hit-testing。
- List 支持上下/Page/Home/End/Enter；Gallery 按实际 CSS 列数支持二维方向键。空搜索时左右浏览 Gallery，有查询文字时左右保留 caret；隐藏 iframe 持有焦点时集合键转交当前 Shell。
- query、active tab、selectedId 使用宿主乐观反馈 + 插件受控回画；action 事件携带触发瞬间 selectedId，避免快速选择后执行落到旧条目。
- iframe → host 发布只接受当前 panel 的 pluginId/runtimeId/contentWindow；数据在 `normalizePluginWorkbenchState` 信任边界限制协议、数量和文本长度。
- Workbench 信任边界收紧为强制稳定唯一 item id：缺失/重复 item/tab id 直接拒绝，并补齐单 active tab、空 detail 清理与完整 `data:image/` 校验，避免不可寻址选择、重复 React key 或内嵌图被截断。
- Workbench 重构插件异步审计：Brew/Unsplash/QxGH 已有 generation，Pomodoro 读取同一持久化快照；补齐 CLI Workbench 示例和 Qx Bing Wallpaper 的请求代次检查，防止连续刷新时旧响应覆盖新结果。
- 内部架构、端口清单、公开 CLI→GUI / 插件开发 / plugin system 文档已同步维护。

### 验证

- [x] `npm run test:shell-navigation`
- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [x] `cargo fmt --check` / `cargo check` / `cargo test --lib`（73 tests）
- [ ] macOS：Brew List、Bing/Unsplash Gallery 的鼠标、四向键、搜索、Tabs、Enter 与 Cmd+K 连续人工验收。

## Feature — Launcher 文件类型分组与 Cardinal 分类优先级

**状态**：已实现，等待真实文件集运行态复核。

- 文件结果按用户可配置的类型分类顺序呈现；默认顺序为文件夹、多媒体、代码、Office、图片、压缩包、其他文件，分类行采用 hairline 线性分隔，不使用卡片容器。
- 分类行和文件行进入同一键盘选择序列；↑/↓ 可选中分类，Enter 切换该分类的展开/折叠。
- Settings → File Search 支持拖动排序、键盘上移/下移、新增、编辑和删除分类；兜底“其他文件”始终保留。
- 每个分类可选择多个扩展名；前端每个 pass 只发起一次可淘汰的 `search_files`，后端在同一 blocking 任务内按分类优先查询并平衡结果，再由前端渐进合并多 pass。新 query 会使旧 Cardinal 工作失效，Spotlight 子进程不持有 Cardinal 锁，避免快速输入堆积分类任务或阻塞后续搜索。
- 后端返回文件 `modified_at`；每个分类内默认按修改时间倒序。
- 非文件结果固定分为 Qx 内置、应用程序、外置插件三个线性可折叠组；Qx 内置命令/模块使用启动时同步注册的本地目录优先进入候选，不等待应用、文件或外置插件 IPC。

### 验证

- [x] `npx tsc --noEmit`
- [x] `cargo test --lib file_search:: -- --nocapture`
- [x] `npm run check` / `npm run build` / `cargo check`
- [ ] macOS：真实 Cardinal 索引下分类优先、折叠键盘连续性和设置拖动持久化。

## Feature — RSS 标准主从列表 + 阅读进度恢复

**状态**：已实现，等待真实长文章运行态复核。

- RSS 详情页左栏确认并收口到 `useQxListSelection` + `useQxMasterDetail`，继续使用 Qx 标准列表选择、区域焦点和键盘导航。
- `rss_articles.reading_progress` 按文章保存 0–100 归一化位置；滚动停止 600ms 后写入，切换或离开文章时立即收口。
- 打开文章时等待正文布局并在图片加载引起尺寸变化时重算恢复位置；左侧列表显示未完成文章的百分比。
- 每篇文章拥有独立阅读会话快照、定时器和恢复生命周期；切换时不从复用后的新文章 DOM 回写旧文章，后台落库也不会触发二次恢复。

### 验证

- [x] `npx tsc --noEmit`
- [x] `cargo fmt --check`
- [x] `cargo check`
- [x] Rust 阅读进度内存数据库测试
- [x] `npm run check`
- [x] `npm run build`
- [ ] macOS：长文章滚动后退出、重启 Qx、调整栏宽/字体后恢复位置。

## Feature — 录屏历史 List / Gallery 切换

**状态**：已实现，等待运行态视觉与真实媒体复核。

- 捕获历史新增持久化的列表 / 图库切换；列表和图库均占满主内容区，选择后在同一主内容区进入全宽预览，不再渲染固定右侧详情。
- 截图/GIF 使用图片缩略图，MP4/MOV 使用视频首帧；两种布局共享选择、预览、删除与 QxShell 键盘导航。
- 移除模块内重复的上下键监听，统一走 Shell navigation + `useQxListSelection` 滚动追随。
- Gallery 改为默认浏览面，网格占满 Main Area；点击后进入独立预览，Esc 返回网格，List 保留为可选紧凑视图。
- Rust 录屏统一优先使用原生连续视频流，区域录制在流帧上裁剪；修复慢帧后额外等待完整帧间隔导致的实际 FPS 腰斩。
- 录制控制岛与历史媒体卡片显示实测 fps，便于区分“目标 30fps”和实际编码吞吐。
- 捕获岛关闭 / 取消常驻会回传并持久化 `controls_pinned=false`，后台恢复与重启不再复活空闲岛。
- Release capability 明确允许 core event listen/unlisten/emit，主窗口可接收独立捕获窗的 pin 状态同步，不再因 ACL 拒绝保留旧内存值。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [ ] macOS：真实截图/录屏、布局记忆、键盘选择、预览与删除。

## Refactor — 市场模块统一 Gallery / 左侧 List

**状态**：已实现第一批，等待运行态视觉复核。

- `unsplash` 1.1.0：移除自绘 iframe 网格、工具栏和底部按钮，改用 Workbench Gallery、宿主搜索、图片详情与 item/panel Actions；补齐最近搜索缓存和 Windows 实际壁纸路径。
- `brew` 1.1.0：移除自绘列表与操作条，改用 Workbench 左侧 List + 右侧 Detail、Installed/Outdated/Search tabs、结构化状态和确认式 Actions。
- 保留专用布局：Weather（预报卡）、External Display Control（滑杆）、Calendar（月历）；QxGH 与 Pomodoro 已是 Workbench。

### 验证

- [x] 两个插件 `node --check` + manifest 版本检查
- [x] 模拟宿主发布验证：Unsplash = Gallery + 5 item Actions；Brew = List + Detail + 3 item Actions
- [x] `npm run package:plugins` + `unzip -t` + 本地覆盖安装与入口语法检查
- [x] 本机真实 `brew info --json=v2 --installed`：成功解析 78 条已安装记录
- [ ] Qx 运行态：搜索、键盘选择、Actions、缓存与真实 CLI/HTTP 主路径

## Feature — Workbench Gallery + Qx Bing Wallpaper

**状态**：已实现，等待运行态视觉与真实桌面壁纸复核。

- Workbench 新增声明式 `layout.kind: "gallery"`、安全图片字段、响应式列数与横/方/竖比例。
- Gallery 复用宿主键盘选择、滚动追随、QxShell 主动作、右侧 Actions 与 Cmd/Ctrl+K。
- 市场只保留原生 `qx-bing-wallpaper` / **Qx Bing Wallpaper**：直接使用 Qx http/storage/system/cli/file 端口，不包含 Raycast shim、旧包别名或转换元数据。
- 插件提供 16 张 Bing 每日壁纸图库、搜索、缓存/stale fallback、设为壁纸、下载、复制链接、打开来源、随机设置、刷新与日更后台命令。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [x] `npm run package:plugins`（市场仓库）+ `unzip -t` + 本地安装与入口/manifest 语法检查
- [ ] macOS / Windows：Gallery 键盘选择、所有 Actions、真实设壁纸。

## Feature — 统一列表选中浅色背景 + 键盘滚动追随

**状态**：已实现。

### 内容

- `useQxListSelection` / `getQxListItemProps`：`qx-list-row` + `is-active` + `data-qx-list-index`，`scrollIntoView({ block: "nearest" })`。
- 按键仍归 `QxShell.navigation`；绘制与滚动不再由各模块手写。
- 已接入：Clipboard、Launcher ResultsList、RSS feeds/articles、V2EX、QxAI 会话列表、Documents 文件列表。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动：各模块 ↑↓ 浅色选中 + 越界自动滚入视口。


## Bugfix — outside click 自动隐藏被聚焦重试复活

**状态**：已实现，等待运行态复核。

- Launcher 失焦或隐藏时立即取消搜索框的 rAF、timeout 与 key-window debounce。
- `floating_request_key` 收口到主线程，并在调用 AppKit 前重新确认面板仍为 open 且 native visible；迟到的 `makeKeyAndOrderFront` 不再复活已隐藏窗口。
- 搜索框 mount/focus event 只在 store `visible` 为真时申请 key window，保留默认聚焦同时恢复 outside click 自动隐藏。

## Bugfix — 中文“设置”召回 Qx Settings

**状态**：已实现，等待运行态复核。

- Settings 内置命令搜索词补齐中英文别名：设置、偏好设置、插件、扩展、快捷键、外观、高级及 Qx 组合词。
- Settings 结果统一带 `moduleId: settings`、中文 `display_name`、Qx subtitle 与预计算匹配档位；中文精确查询优先于系统设置应用和同名文件。
- 自定义搜索元数据仍复用同一 Settings entry 工厂，避免两条路径的显示和排序语义漂移。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [ ] macOS：输入“设置”“偏好设置”“扩展”“qx settings”均可打开 Qx Settings。

## UI Polish — 扩展连续列表与主搜选中态

**状态**：已实现，等待运行态视觉复核。

- Settings → Extensions → Installed 从逐项大卡片改为 Built-in / External 分组连续列表：组内共享外框、hairline 分隔，图标由 44px 收紧至 34px，行高由 60px 收紧至 52px。
- Launcher 选中行使用弱 accent 混合背景、完整浅蓝细描边与稍强标题字重，在透明浅色主题下与 hover 保持可辨识；不使用点阵、左侧实线或括号式连续轮廓。
- Launcher 重新获得焦点时对主搜索框执行有限重试聚焦；空白 WebView 焦点下的 Esc 由窗口内 bubble fallback 收口，空 query 可稳定隐藏。
- 内置模块关键词补齐常用中英文别名；外部扩展的 manifest 级关键词合并进入每条命令和 panel，并统一使用大小写、Unicode 与空格/常见分隔符不敏感匹配。
- 结果行暴露稳定索引；键盘或 hover 改变选中项后调用 `scrollIntoView({ block: "nearest" })`，向下越过可视区域时列表自动跟随且不强制居中。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`
- [ ] macOS 浅色 / 深色与低透明度视觉复核。

## Search UX — 持久搜索焦点与非阻塞结果更新

**状态**：已实现，等待最终输入手感复核。

- 带搜索框的 QxShell 在普通 pointer 交互结束后自动回到搜索；真实输入/编辑器、选中文本及
  打开的 Dialog/Menu/Listbox 保留焦点。Launcher 对非编辑焦点下的首字符与删除键做 capture
  级转交，避免第一次输入丢失。
- 输入变化立即废弃旧 sequence / AbortController，但延迟约 45ms 后才启动新 provider；文件
  扩展 pass 再错峰 80ms，避免一次按键并发启动三轮索引查询。
- 渐进结果在输入静默窗口后合并提交；排序 Worker 不再每批 terminate/recreate，只执行当前
  任务并保留最新一个等待任务。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run check`
- [x] `npm run build`、release app bundle、安装、签名验证与进程启动。
- [ ] macOS：连续快速输入、删除、IME、点击列表/按钮后立即输入，以及编辑器不被抢焦点。

## Bugfix / Feature — macOS 文件搜索与插件外接灵动岛

**状态**：已实现并安装到本机；自动化构建与真实 Cardinal 索引查询已复核。

- 修复 Cardinal 嵌入式索引使用 `name:` 过滤返回空候选的问题；普通查询改回索引原生
  token / wildcard 召回，再由既有 leaf-name 后过滤保持“只匹配文件名”语义。
- Cardinal 默认匹配端统一对普通词、路径分段与通配符执行 Unicode 不区分大小写匹配；
  Qx 无需枚举大小写变体，小写 `spf` 可直接召回真实大写 `SPF-*` 文件。搜索仍合并
  `mdfind -name` 补充样本，以降低结果窗口被噪声占满的影响。
- 文件名匹配把空格、连字符、下划线、点号等视为弱分隔，并为至少三个字符的查询
  提供有序子序列模糊召回；Cardinal、Spotlight 与 Everything 都生成对应的 token / wildcard
  查询，最终仍由统一 leaf-name 匹配与相关性排序把精确结果放在模糊结果之前。
- Appearance 新增 External Island Display 设置，控制是否允许手动浮出、已浮出窗口在
  主窗隐藏时是否保留以及是否置顶。
- 插件新增 permission-gated `context.island.show/update/dismiss`；每个插件只有一个
  slots-only display session，可显示文本、真实进度与一个 manifest command 动作。
- 插件不能声明 task/error 优先级、组件、自定义窗口位置或置顶策略。

### 验证

- [x] `cargo test --lib file_search:: -- --nocapture`
- [x] `npx tsc --noEmit`
- [x] `npm run test:island`
- [x] `npm run check`
- [x] release app build、安装、签名验证与进程启动。
- [x] 使用本机持久化 Cardinal 缓存验证 `SPF*` 可召回 Downloads 中的真实 `SPF-*` 文件。
- [ ] 最终 UI 视觉复核（自动化环境存在多个相同 bundle id 的窗口，窗口选择不稳定）。

## Feature — 系统毛玻璃、窗口不透明度与模糊独立控制

**状态**：已实现，等待运行态复核。

- Appearance 新增系统毛玻璃开关与 0–30px 模糊强度；窗口不透明度扩展到 100%。
- 关闭毛玻璃时所有 CSS 表面强制不透明、blur 归零，并通过主线程命令清除 macOS Vibrancy / Windows Acrylic；重新开启恢复保存值。
- 原有 Top Bar、内容表面、控件和 Bottom Bar 分区透明度继续保留。

## Feature — 搜索结果 30 天点击量与异步高频召回

**状态**：已实现，等待运行态复核。

### 内容

- `history.db` 新增 `search_click_events`；打开任意启动器结果时 `record_search_click`（fire-and-forget），滚动保留 30 天。
- `get_search_click_stats` 聚合 path 点击量；前端 `searchUsage` 缓存，主搜索先出相关结果，再异步 stamp / 合并仍匹配 query 的高频项并 `rankSearchResults`（相关度优先，点击量为同档 tie-break）。
- 全局排序通过 `rankResultsAsync` 投递到独立 Web Worker；候选快照保证渐进 provider 不丢批次，`rankRequestSeqRef` + latest-wins 丢弃/终止旧排序，Worker 异常时保留 provider 顺序且不在 UI 线程补做同步排序。
- 主搜索 provider 改为真正并发：固定模块/命令当轮先发布，应用内存搜索、文件、剪贴板、动态模块与使用召回独立合并；首批结果不等待 Worker。`search_apps` 非空查询热路径移除缓存锁内图标文件检查。
- 设置「清除启动历史」一并清空点击事件。

### 验证

- [x] `npx tsc --noEmit`
- [x] `cargo check`（`src-tauri/`，通过；存在项目既有 warning）
- [ ] 手动：多次打开同一结果后再次搜索，同匹配档位下高频项更靠前；输入过程不卡顿。

## Bugfix — 剪贴板选中延后写入系统剪贴板

**状态**：已实现，等待运行态复核。

### 问题

- 单击历史条目会在约 180ms 后立刻 `writeClipboardEntry` + `record_clipboard_copy`。
- `record_clipboard_copy` 更新 `timestamp` / `copy_count`，历史重载后列表在主窗口仍打开时跳动，选中与预览视觉不稳定。

### 修复内容

- 单击 / 键盘选中 / 模块 deep-link 只 `queueClipboardRestore`，不写系统剪贴板。
- 主窗口失焦（隐藏）时 `flushClipboardRestore` 再回写系统剪贴板并记次。
- 显式 ⌘C 仍立即复制；Enter 粘贴仍立即写入后 `plugin_perform_paste`（并清除 pending，避免隐藏时二次写入）。

### 验证

- [x] `npx tsc --noEmit`
- [ ] macOS：选中条目列表不跳动；隐藏 Qx 后系统剪贴板为所选条目；⌘C / Enter 行为不变。
- [ ] Windows 手动验证同上。

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
- 当前窗口切换默认 `Alt+Space` 并启用；Launcher 搜索切换预设 `Alt+Shift+Space` 但默认关闭，两者均可在 Settings → Shortcuts 单独录制和启停。旧设置会自动补齐新增快捷键项，同时保留用户已有绑定。
- 快捷键设置补齐中英文标签、语义说明与按钮文案，并允许 Qx 自身注册默认 `Alt+Space`，仍拦截系统 `Cmd/Ctrl+Space`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在当前工作区既有 warning）
- [x] `cargo test --lib settings::tests::default_global_shortcuts_only_enable_window_toggle -- --nocapture`
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

- **鼠标所在桌面默认跟随（2026-07-16）**：圈选启动默认落在鼠标所在显示器；尚未开始框选时由 Rust 后台复用统一 `display` 服务检测跨屏并迁移受保护圈选窗，开始交互、已有选区、倒计时或确认后立即停止跟随，session 结束时后台任务自动退出。
- **P0–P1 交互重设计（2026-07-15）**：意图驱动主按钮（Enter/S/R）；模块双入口收敛；区域重画 + 八向手柄；延迟 0/3/5s 倒计时穿透；`confirmMode` 精修/松手即捕；窗口悬停选取；标注扩展（矩形/画笔/颜色/撤销重做）；截图 post-capture toast；无视频编辑。
- **系统能力层（SOLID）**：窗列表提升为 `desktop_windows`（`desktop_windows_list`）；显示器公共 IPC `display_list` + `display::capture_region`；剪贴板 `clipboard_write_image_file`；前端端口 `src/system/*`；screencap 仅消费系统服务与保留工作流门面。
- **截图闭环补齐**：录制停止后 `restore_selection` 回灌选区；预览支持复制图片；历史按扩展名识别截图；Esc 分层（草稿/选区/退出）；窗选在 session 就绪后刷新。
- **截图标注增强**：序号标记（5）、马赛克遮盖（6）；历史缩略图；双击选区确认；记忆上次选区；搜索文案「截图与录屏」。
- **修复截图后闪退（SIGTRAP）**：根因是 async 命令在 tokio worker 上调用 AppKit（`show_floating` / `setLevel` / 剪贴板）；新增 `main_thread::run_on_main`，浮窗/捕获岛/圈选窗/剪贴板写图一律回主线程。
- **修复录制闪退**：崩溃栈为 `start_recording` → `controls::show` → `promote`（同样非主线程 AppKit）；`start_recording` UI 收拢到一次主线程事务，圈选窗打开/内容保护一并主线程化。
- **通用 runtime 线程模型**：`src-tauri/src/runtime/`（`install` / `ui` / `run_ui` / `blocking` / `spawn_ui`）；setup 钉主线程 id；截图命令示范 `blocking→ui`；island 窗体 hop；文档 `docs/runtime-threading.md`。
- 显示器枚举、稳定 ID、内置/外接/主屏判断、鼠标所在屏幕和 Tauri/捕获后端映射提升为 Qx 系统级服务；截图模块只保留圈选几何、裁剪与录制状态，热插拔监听复用系统服务。
- 修复首次启动后第一次唤起落到隐藏窗口创建显示器或旧 macOS Space：标准化鼠标坐标优先、原生坐标仅兜底，窗口显示后重新按目标 DPI 校正，并使用 active-Space 窗口策略。
- 截图以 PNG 接入现有捕获历史和预览，和 MP4/MOV/GIF 共用清理与文件输出目录。
- 区域圈选初始按鼠标所在显示器解析捕获源；圈选层为每个显示器创建浅黑色鼠标穿透遮罩，鼠标所在显示器自动成为交互目标，移除内置屏/外接屏显式切换控件，仅保留区域/窗口/全屏模式入口；记录 xcap 显示器 ID，避免外接屏错误回落到主屏。
- 截图模块进入时通过 `display_list` 异步预热原生显示器缓存，快捷键触发沿用后台显示器监视器的热缓存；圈选首帧不再重复支付完整 xcap 枚举成本。
- 圈选显示器跟随改为立即首检 + 40ms 高频轮询，避免进入截图后鼠标移动到外接显示器时出现明显等待。
- Launcher 新增“开始截图 / 开始录制”独立 command；Shortcuts 新增默认关闭的截图快捷键，录屏快捷键改为直接开始圈选。
- Shortcuts 新增默认关闭的“显示/隐藏捕获灵动岛”（`Alt+Shift+C`）动作；截图完成动作可选自动复制到剪贴板或仅保存，复制失败不回滚已保存历史。
- 原录制控制条扩展为空闲捕获灵动岛，可由用户选择长期置顶外显；空闲提供截图/录制，录制时保持原停止与状态能力。
- 捕获岛新增历史入口；历史区重构为 Qx 标准单栏列表/图库（类型图标、主信息、元信息、行内删除）与全宽预览，移除右侧详情配置和嵌套交互按钮。
- 圈选改为两阶段确认：首次框选后可移动、四角缩放，再选择截图或录制；截图可添加文字和箭头，浏览器生成透明标注层，Rust 按捕获实际像素缩放并合成进 PNG。
- 修复捕获入口先隐藏全部 Qx 窗口、选区打开失败后看似整应用闪退的问题：选区成功映射后才隐藏来源窗口，失败时保留原界面并记录诊断。
- 区域录制期间保留受保护、鼠标穿透的录制边框，录制岛定位到边框下方；停止后恢复原选区的拖动、缩放和重复捕获，不再强制丢弃选区返回主界面。
- 修复截图成功后圈选窗口未关闭，以及录制时透明全屏圈选器吞掉桌面输入的问题：悬浮岛点击捕获立即隐藏；截图完成恢复入口界面；录制边框先缩至选区范围，穿透失败则安全隐藏。
- 拆分 Rust 捕获入口大文件：`mod.rs` 只保留模块声明和稳定导出；圈选工作流、录制生命周期、状态、悬浮控制窗、圈选窗、截图合成、录制引擎、命令/历史适配、几何和存储分别落入职责文件，测试跟随实现模块。
- 媒体处理是 Qx 根级核心能力：H.264 码流与 MP4 封装、媒体尺寸约束、GIF 转换统一放入 `src-tauri/src/media/`，不得反向依赖 `screencap`；截图模块只消费媒体服务并维护自身流程与历史。
- 修复圈选窗口闪退假象：`region-picker` 补入 Tauri capability，恢复显示器枚举、事件监听和截图/录屏确认 IPC；截图 worker panic 不再越过恢复分支，失败时恢复选区并写入诊断日志。
- 架构检查新增捕获 surface capability 门禁，确保 `main`、`recording-controls`、`region-picker` 不再漏配。

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

## Feature — Clipboard 文本编辑、日期筛选与单击复制

**状态**：已实现，等待双平台运行态验证。

- 文本条目双击进入本地草稿编辑；修改默认不保存，未保存时灵动岛使用 danger 状态提醒，并提供保存原条目、另存为新条目和 Esc 放弃路径。
- 日期分组标题使用 Geist Calendar Popover，支持本地时区的单日/范围选择、月份与键盘导航、范围高亮，以及今天、最近 7 天、最近 30 天和全部日期预设。
- 单击历史条目只写入系统剪贴板，方便用户手动粘贴；不会直接向其他应用发送粘贴键，原 Enter 粘贴动作保持不变。
- Rust 文本持久化命令独立放入 `clipboard/editing.rs`，不继续扩大剪贴板监听主文件。

## Search polish — 默认快捷入口与 Cardinal 文件排序

**状态**：已实现，等待 macOS 真实文件集与 Windows Everything 运行态验证。

- Launcher 右侧默认快捷入口收敛为剪贴板、RSS、设置和文件搜索；旧版完全未修改的十项默认配置自动迁移，用户自定义配置保持不动。
- 文件搜索快捷入口直接切换到 Files scope、清空旧查询并重新聚焦搜索框。
- Rust 文件搜索统一折叠多余空白并仅拒绝空白查询；单字符也进入快速 pass。Launcher 在 All / Files 下每次非空 query 增删都立即调用 pass 0，Cardinal 后续召回异步合并去重，并按名称相关性、文件优先和修改时间倒序比较。

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
- 主仓与 `qx-plugins` 转换器已同步该协议，通用转换能力由中性 fixture 验证。
- 验证 Raycast `calendar`（commit `186d955eda64f9e956b25a3fdf5566b1d38f57f2`）：依赖 `calendar` / `weeknumber`，转换为 `raycast-calendar` 后可显示日历、切换月份、复制当前视图，并带 3 个 preferences 与 2 张截图。
- 更新 `README.md`、`public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md`、`public/doc/raycast-plugin-conversion.md` 和 `qx-plugins` README。

### 验证

- [x] `node --check scripts/convert-raycast-extension.mjs`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] Native control scan：仅命中 Markdown 内容样式 `src/styles/qx-ai.css:.qx-md-body li input[type="checkbox"]`，非产品控件。
- [x] `qx-plugins` Calendar：`node --check src/raycast-calendar/index.js`、`unzip -t raycast-calendar.qx-plugin`。
- [x] `qx-plugins` Calendar happy-dom 抽样：显示 `# July 2026`，点击 `Next Month` 后变成 `# August 2026`，`Copy` 写入 clipboard bridge 且内容匹配当前视图。
- [x] 本机安装 `raycast-calendar.qx-plugin` 到 `~/.qx/plugins/raycast-calendar`，manifest、`index.js` 语法、`.enabled`、1 个命令、3 个 preferences、2 张截图验证通过。
- [ ] 手动验证：Settings -> Extensions -> Installed -> Display 开关保存；转换插件在宽面板显示动作按钮，窄面板先隐藏；关闭开关后重新打开插件不显示动作按钮。

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

**状态**：Frozen / 暂停维护。代码与入口保留用于历史研究；正式插件统一基于上游源代码按 Qx 协议重新开发。

- CLI 运行时和 Extensions 导入界面均显示冻结提示；主仓、市场仓与开发文档不再把 re-convert 作为维护或发布路径。

### 修复内容

- 使用中性 Gallery fixture 验证 `@raycast/api` React view、Node fetch/fs、后台 command runtime 等通用转换能力。
- CLI 转换器新增 generic Raycast shim：使用 esbuild 打包 Raycast TS/TSX command，虚拟替换 `@raycast/api`、`node-fetch`、`file-url`、`fs-extra`、`run-applescript`、`os`、`path`、`buffer`。
- Shim 覆盖 `List` / `Grid` / `Detail` / `ActionPanel` / `Action` / `Toast` / `showToast` / `showHUD` / `LocalStorage` / `Cache` / `getPreferenceValues` / `open` / `showInFinder` / `Clipboard` / `useNavigation` 等常用 Raycast API。
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
- [x] `cargo test marketplace::tests -- --nocapture`（`src-tauri/`，含 generic manifest 测试）
- [x] `npx tsc --noEmit`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `npm run build`

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
- 2026-07-16 回归修复：降低透明度时同时降低窗口 CSS 模糊强度，使背景细节真正变得通透而不只是改变白/黑叠层亮度；表面 alpha 全范围跟随滑块，浅色 secondary/tertiary token 与列表/设置说明提升对比度。
- 2026-07-16 分区设置：Appearance 将窗口背景、Top Bar/Context、内容表面、Action/控件和 Bottom Bar 拆为独立持久化透明度；Popover 跟随 Action/控件并以 Bottom Bar 的视觉强度为下限，旧设置通过默认字段兼容。
- 2026-07-16 滚动统一：移除浏览器伪元素与 Radix 两套可见 scrollbar，所有宿主 overflow、ScrollArea 与插件 iframe 改用同一全局自绘浮层，停止滚动 720ms 后淡出。

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
- 原 `系统` 模式文案改为 `系统信息`，保留 CPU / MEM 异步监控；旧 GPU 配置字段仅为兼容保留，不再渲染。
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
