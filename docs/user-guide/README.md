# Qx 用户指南

> 状态：Current · 适用版本：v0.6.103 · 平台：macOS、Windows · 最后复核：2026-08-31

Qx 是后台常驻的桌面效率工具。它以搜索为入口，把应用、文件、内置模块和已安装插件放进同一个紧凑窗口；内容处理、权限和插件能力由本机 Qx 宿主管理。

## 安装与首次启动

从项目发布页安装适合当前平台的 Qx。Apple Silicon Mac 也可使用 Homebrew：

```sh
brew tap mcxen/qx
brew install --cask qx
```

macOS 首次启动会依次说明完整磁盘访问权限，以及可选的辅助功能、屏幕录制和输入监控权限。每一步都可以跳过；跳过只会让对应能力不可用，不影响基础搜索和设置。Windows 安装后由 Qx 使用系统 WebView2 运行。

首次介绍结束后，普通启动、登录项恢复、屏幕唤醒和应用激活都不会主动弹出主窗口。使用已配置的全局快捷键召唤 Qx。

## 主窗口

主窗口固定为三部分：

1. 顶部搜索与筛选；
2. 中间结果或模块内容，必要时带右侧 Context Panel；
3. 底部状态 Island、主动作、Actions 和最右侧 Esc。

空查询时 Launcher 显示 Home Dashboard；输入后展示应用、文件、内置模块和插件结果。Settings → General → Module Search 可决定是否把模块内部条目（例如 RSS 订阅或 AI 会话）加入主搜索。

常用键盘操作：

| 操作 | 按键 |
|---|---|
| 上下选择 | `↑` / `↓` |
| 打开、执行主动作 | `Enter` |
| 打开或关闭详情 | `→` / `←` |
| 打开 Actions | macOS `⌘K` / Windows `Ctrl+K` |
| 逐层返回、清搜索、最终隐藏 | `Esc` |

Esc 每次只退一层：先关闭 Dialog、预览或详情，再清模块查询、返回上一级、离开模块、清空 Launcher 查询，最后隐藏窗口。底部可见 Esc 与键盘执行同一层级。

## 全局快捷键

Settings → Shortcuts 可以启用、停用或重新录制全局快捷键。默认主窗口切换键为：

- macOS：`Option+Space`
- Windows：`Ctrl+Alt+Space`

其它模块、应用和插件快捷键只有用户明确启用后才会注册。快捷键冲突时，Qx 保持运行并提示更换组合；不会让隐藏窗口或插件占用未启用的系统按键。

## 内置能力

Settings → Extensions → Installed 可以统一启停内置模块和外部插件。当前主要内置能力包括：

- Clipboard：文本、图片和真实文件列表历史，按需加载旧记录；
- RSS：订阅、目录、阅读进度、离线文章和阅读设置；
- Screen Capture：截图、录屏、标注、OCR、历史与文件导出；
- File Actions / QxPreview：处理召唤 Qx 前 Finder 或 Explorer 中的选择；
- Documents / Text Toolbox：本地文本与文档处理；
- QxAI / P仔：模型、会话、工具与阅读上下文；
- Macros、QxTTY、Settings 和可选的 Home providers。

V2EX、Hacker News、Bing Wallpaper、Unsplash、Brew 等属于市场插件，不应被当作内置模块。插件是否可用取决于平台、权限、外部服务和插件自己的兼容版本。

## 插件

在 Settings → Extensions 中：

- Installed 管理启用状态、命令、快捷键、偏好、权限和卸载；
- Plugin Store 浏览市场并安装兼容版本；
- Import 导入可信的 `.qx-plugin` 或 `.zip` 包；
- Rescan 在需要时重新扫描本地安装目录。

插件包安装在 `~/.qx/plugins/<id>/`，可持久数据保存在独立的 `~/.qx/plugin-data/<id>/`。升级或重装包不会覆盖持久数据；卸载或清理前，Qx 会按明确的宿主操作处理数据，而不是把包目录当数据库。

只安装信任来源的插件。插件使用 HTTP、CLI、文件、剪贴板、AI 等能力前必须在 manifest 声明权限，并通过 Qx 的受限宿主端口调用。

## 设置与存储

- General：启动行为、Module Search、Home Dashboard；
- Search：结果来源、排序和文件搜索；
- Shortcuts：主窗口、模块、应用与插件快捷键；
- Appearance：主题、透明度、密度、窗口行为和标题栏；
- Extensions：内置模块与市场插件；
- AI Agent、OCR、RSS Reader、Permissions：对应能力的配置和诊断；
- Storage Management：按模块查看和清理可重建缓存。

“清理缓存”不会删除设置、数据库、剪贴板历史、已保存截图/录屏或插件持久数据。插件持久数据会作为独立类别显示。

## 常见问题

### 按快捷键没有出现窗口

先从系统应用列表打开 Qx，检查 Settings → Shortcuts 是否启用且没有冲突。macOS 使用 `Cmd+Space` 等系统保留键时，还需对应辅助功能或输入监控权限。

### 文件、剪贴板或截图能力不可用

到 Settings → Permissions 查看状态。macOS 完整文件搜索需要 Full Disk Access，自动粘贴需要 Accessibility，截图和录屏需要 Screen Recording；Windows 文件选择来自召唤前的 Explorer 窗口。

### 插件安装后打不开

确认插件最低 Qx 版本、支持平台和权限；在 Installed 中查看详情，必要时 Rescan。网络或 CLI 插件还需要真实上游服务或本机命令可用。

### 想开发插件或维护发布

用户指南不复制作者协议。插件作者从 [`public/doc/plugin-development-guide.md`](../../public/doc/plugin-development-guide.md) 开始，运维人员使用 [`public/doc/release-workflow.md`](../../public/doc/release-workflow.md)，完整公开索引见 [`public/doc/`](../../public/doc/)。
