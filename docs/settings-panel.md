# Settings 面板

> 状态：Current · 适用版本：v0.6.97 · Owner：Frontend · 最后复核：2026-08-19
>
> 开发者文档。Settings 使用 **线性分区（liner）**，不是营销式大卡片。导航分组见 `SettingsPanel.tsx` 的 `NAV_GROUPS`（General、Search、Shortcuts、Appearance、Extensions、Features、System），不是固定 6 个标签。

## 0. 打开 / 关闭端口（必读）

模块与插件**不得**直接 `setTab("settings")` 或手写 `sessionStorage` 拼装跳转。
统一走：

| API | 路径 | 作用 |
|-----|------|------|
| `openSettings(options?)` | `src/modules/settings/openSettings.ts` | 打开设置；记录一层 `returnTo` |
| `closeSettings()` | 同上 | Esc 最终 leave / Close；回到 `returnTo` |

```ts
import { openSettings } from "../settings/openSettings";

// 从天气模块进其内置扩展配置：Esc 回天气
openSettings({ focusPluginId: "builtin:weather" });

// 打开某插件/内置模块配置卡：Esc 回当前 panel
openSettings({ focusPluginId: "builtin:screencap" });

// 主页搜索进设置：显式回 launcher
openSettings({ returnTo: "launcher" });
```

`returnTo` 规则：

- 省略：当前 tab 为模块/插件 → 记该 tab；已是 settings → 保留旧值；launcher → `launcher`
- `"launcher"`：强制主页
- `null`：保留已记录的返回目标（同一会话内再 refine section）
- 无效 / 已禁用内置模块 → fallback `launcher`

`App` 挂载：`<SettingsPanel onClose={closeSettings} />`。`navigate` / `qx:navigate`
的 `"settings"` 载荷同样走 `openSettings()`。

## 1. 结构

```
QxShell (visual="elevated")
├─ topbar · 搜索设置
├─ main
│  └─ SettingsPanel
│     ├─ .qx-settings-title          当前页名
│     └─ ScrollArea / PluginManager
│        └─ .qx-settings-page
│           └─ SettingsCard[]        ← 实为 section，非 box card
│              ├─ section title (uppercase)
│              └─ Row[]              ← 行间 hairline
└─ context · 侧边导航
```

### 侧边栏分组

| 分组 | 页 | 内容原则 |
|------|-----|----------|
| **Basics** 基础 | General · Search Settings · Appearance · Shortcuts | 人人都会改的全局偏好 |
| **Extensions** 扩展 | Extensions | 安装 / 管理插件 |
| **Features** 功能 | AI · OCR · RSS | 内置模块自己的偏好 |
| **System** 系统 | Permissions · Storage Management · Advanced · About | 权限、模块存储、进阶、关于 |

### 各页职责（Current）

| 页 | 分区 |
|----|------|
| **General** | 启动与行为（登录启动、语言、自动更新开关；更新源在 About） |
| **Search Settings** | 文件类型分类 · Cardinal/Everything 优先级 · 拖动排序 · 新增/编辑/删除 · 启动器模块搜索源 |
| **Appearance** | 应用图标 · 主题与分区透明度 · 窗口与密度 · Home Island |
| **General** | 启动与行为 · 托盘菜单（加入即显示、拖动排序） |
| **Shortcuts** | Qx 主窗口召唤 / 应用快捷键；模块快捷键在对应插件详情中配置 |
| **Extensions** | Installed 使用分组连续列表，Browse 使用主从列表，配置走 Dialog；天气等内置扩展的专属配置也在此处 |
| **AI Agent** | 供应商 · 模型 · 工具 · Bash · Grep |
| **OCR / RSS** | 各自模块设置 |
| **Permissions** | macOS 权限 |
| **Advanced** | 数据路径 · 诊断日志开关/级别/文件入口 · 网络 · 配置导入导出 · 清理 · 开发 · 重置 |
| **Storage Management** | 仅按模块列出可重建存储；表格行展示大小、项目数与逐项清理，不重复展示物理存储桶 |
| **About** | 版本、**更新源**、检查/下载更新与发布页 |

### 扩展列表显示名（i18n）

Settings → Extensions 的插件/模块标题与描述必须走
`src/plugin/pluginLabels.ts`（`localizePluginName` / `localizePluginDescription`），
**禁止**直接渲染英文 `plugin.name`：

| 来源 | 解析顺序 |
|------|----------|
| 内置 `builtin:<id>` | manifest `names` → `launcher.<id>` → `module.<id>` → `name` |
| 外置插件 | manifest `names` → `name` |
| 市场 Browse | 索引 `names` → `name` |

描述同理（`descriptions` / `launcher.<id>.desc` / `description`）。社区插件必须在
`manifest.json` 自带包含 `en` 与 `zh-CN` 的 `names` / `descriptions` 多语言 map；宿主不
维护按插件 ID 分散的兼容翻译表。

设置页中的社区插件权限、偏好和命令也必须经过同一个宿主本地化端口：偏好使用
`labels` / `descriptions` / `placeholders`，选项使用 `options[].labels`，命令使用
`titles` / `descriptions`，面板使用 `titles`。插件发布前必须补齐这些字段；缺失时宿主
只显示包内原始文本，不会按插件 ID 维护兼容翻译。权限代码仍统一映射为用户可读的中文
名称；不得直接把 `http`、`open-url`、`clipboard` 等能力代码当作设置文案展示。

内置模块的专属选项统一放在 **Extensions → Installed → 模块配置**。Screen Capture
的格式、帧率、质量、分辨率、录屏圈选确认、0/5/10 秒延迟、截图提示音、浮动缩略图、
记忆选区、截图/录屏保存目标与自选目录、完成后打开方式、指针/点击效果、麦克风设备、
录制后隐藏、自动复制和捕获岛常驻都由 `screencap` 设置段集中保存。旧版 3 秒延迟值继续
可读取并在新控制栏中映射为 5 秒；模块主界面只提供进入该配置的直接链接。

Appearance 的透明度不是单一全局 alpha。设置模型保留
`appearance.blur_opacity` 作为兼容字段承载窗口背景不透明度，并新增：

- `title_bar_visible`：在 macOS 与 Windows 主窗口顶部显示 Qx 自绘标题栏；默认关闭。标题栏复用 Shell 主题变量与拖拽协议，提供最小化、最大化/还原和隐藏窗口控制；关闭按钮不得销毁后台 helper；
- `window_behavior`：主窗口显示方式，取值为 `always-on-top`（始终置顶）、`normal`（普通窗口）或 `auto-hide`（悬浮桌面且失焦隐藏）；默认保持原有的悬浮失焦隐藏行为。旧版 `general.autoHideOnBlur` 会在读取时迁移为 `normal` / `auto-hide`，并继续同步保存以兼容旧托盘逻辑；
- `show_in_app_list`：是否在 macOS Dock 或 Windows 任务栏保留 Qx 图标；默认关闭。开启后应用仍使用同一个可复用主窗口，不会改变三种窗口显示方式；

- `glass_enabled`：统一启停 macOS Vibrancy / Windows 11 Mica 与 CSS 毛玻璃；Windows 10 使用高不透明度表面回退，不启用拖拽性能较差的 Acrylic；关闭时所有表面完全不透明，但不覆盖已保存的分区参数；
- `blur_radius`：独立的 CSS 背景模糊半径（0–30px），不再由窗口不透明度推导；

- `shell_region_opacity`：Top Bar 与 Context 区域；
- `surface_opacity`：列表、卡片、设置行和内容面板；
- `control_opacity`：Action、按钮、菜单与 Popover 的高可视表面；
- `bottom_bar_opacity`：Bottom Bar 的独立磨砂表面。

旧配置缺少这些字段时由 Rust `serde(default)` 和前端默认设置共同补齐。
Popover 跟随 `control_opacity`，同时以 Bottom Bar 的视觉强度为下限，
不得退回普通内容表面透明度。

`appearance.app_icon` 保存应用图标 id（`original` / `cloud`）。启动、设置保存、
配置导入与重置都通过根级 `app_icon` 服务应用到 macOS 进程图标和桌面窗口图标；
Windows 必须同时设置 `ICON_SMALL` 与任务栏 / Alt+Tab 使用的 `ICON_BIG`，不得在
仅更新小窗口图标后静默返回成功；
新安装、缺失配置与重置默认使用 `cloud`（云月），已明确保存为 `original` 的用户
继续保留原版图标；
该设置不得改写 `tray-template.png` 或运行中的系统托盘 / 菜单栏图标。

窗口不透明度范围为 5%–100%。`100%` 只表示背景颜色完全覆盖；是否启用系统材质由 `glass_enabled` 独立控制。模糊设为 `0px` 时可得到“透明但清晰”的效果。

## 2. 线性分区规范（UI_SPEC）

`SettingsCard` **不是**带边框阴影的板：

```tsx
<SettingsCard title="Startup & Behavior">
  <Row title="…" description="…"><Toggle … /></Row>
</SettingsCard>
```

渲染为：

```html
<section class="qx-settings-section">
  <header>… uppercase 分区标题 …</header>
  <div class="qx-settings-section-body">
    <div class="qx-settings-row">…</div>
  </div>
</section>
```

| 规则 | 说明 |
|------|------|
| 分区之间 | 一条顶部分隔线，无背景板 |
| 行 | `border-bottom` hairline；最后一行无底边 |
| 分区标题 | 11px / tertiary / uppercase |
| 行标题 | 13px / primary；说明 12px tertiary |
| 禁止 | 分区外再包一层实心 Card、大阴影、营销 CTA |

Dialog 内（扩展配置）同样用 `SettingsCard` + `Row`，保持同一套线性语言。

真正需要「面板容器」时才用 shadcn `Card` / `.qx-card`（例如扩展市场 tile 封面）。

Extensions → Installed 也遵循线性语言：Built-in / External 是分组标签，每组只保留一个外框，模块之间用 hairline 分隔；单个模块不得各自渲染成大圆角卡片。图标使用紧凑尺寸，状态 chips 固定在尾部列，整行点击打开配置 Dialog。

Extensions → Browse 的搜索、仓库筛选和“仓库源”管理入口在同一工具栏内并排展示；
仓库增删改继续使用 Dialog，不在页面正文展开第二行编辑器。

## 3. 关键文件

| 文件 | 作用 |
|------|------|
| `SettingsPanel.tsx` | 导航分组、路由 |
| `GeneralSettings.tsx` 等 | 各页 |
| `components/ui.tsx` | `SettingsCard` / `Row` |
| `styles/settings-actions.css` | 线性分区 + 行样式 |
| `styles/base.css` | 透明度 token |

## 4. 新增设置页

1. `store.ts` → `SettingsTab` 加 id
2. `SettingsPanel.tsx` → `NAV_GROUPS` 合适分组加项 + `TAB_LABELS` + `renderContent`
3. 新建页：仅 `qx-settings-page` + `SettingsCard` + `Row`
4. i18n：`nav.*` + 业务 key
5. `docs/settings-panel.md` 更新本表

### 控件尺寸

- Settings 行使用 `--qx-control-height: 32px` 的常规表单控件；28px 紧凑控件只用于工具栏。
- Select、SegmentedControl、Slider 和组合数字输入使用 `--qx-settings-control-width: 220px` 的统一尾部轨道。
- 普通控件文字为 `12px / 500`，选中态与主操作为 `600`；视觉选项可以增高内容区，但不能另造宽度、字重和状态样式。

## 5. 响应式

| 断点 | 效果 |
|------|------|
| ≤520px | Row 换行，控件独占第二行 |
| ≤760px | PluginManager 单列 |
