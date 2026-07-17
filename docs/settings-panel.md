# Settings 面板

> 开发者文档。Settings 使用 **线性分区（liner）**，不是营销式大卡片。

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
| **Features** 功能 | AI · OCR · RSS · Weather | 内置模块自己的偏好 |
| **System** 系统 | Permissions · Advanced · About | 权限、进阶、关于 |

### 各页职责（Current）

| 页 | 分区 |
|----|------|
| **General** | 启动与行为（登录启动、失焦隐藏、语言、自动更新） |
| **Search Settings** | 文件类型分类 · Cardinal/Everything 优先级 · 拖动排序 · 新增/编辑/删除 · 启动器模块搜索源 |
| **Appearance** | 主题与分区透明度 · 窗口与密度 · Home Island |
| **Shortcuts** | 全局 / 应用快捷键 |
| **Extensions** | Installed 使用分组连续列表，Browse 使用主从列表，配置走 Dialog |
| **AI Agent** | 供应商 · 模型 · 工具 · Bash · Grep |
| **OCR / RSS / Weather** | 各自模块设置 |
| **Permissions** | macOS 权限 |
| **Advanced** | 数据路径 · 托盘 · 诊断 · 网络 · 配置导入导出 · 清理 · 开发 · 重置 |
| **About** | 版本与存储 |

Appearance 的透明度不是单一全局 alpha。设置模型保留
`appearance.blur_opacity` 作为兼容字段承载窗口背景不透明度，并新增：

- `glass_enabled`：统一启停 macOS Vibrancy / Windows Acrylic 与 CSS 毛玻璃；关闭时所有表面完全不透明，但不覆盖已保存的分区参数；
- `blur_radius`：独立的 CSS 背景模糊半径（0–30px），不再由窗口不透明度推导；

- `shell_region_opacity`：Top Bar 与 Context 区域；
- `surface_opacity`：列表、卡片、设置行和内容面板；
- `control_opacity`：Action、按钮、菜单与 Popover 的高可视表面；
- `bottom_bar_opacity`：Bottom Bar 的独立磨砂表面。

旧配置缺少这些字段时由 Rust `serde(default)` 和前端默认设置共同补齐。
Popover 跟随 `control_opacity`，同时以 Bottom Bar 的视觉强度为下限，
不得退回普通内容表面透明度。

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

## 5. 响应式

| 断点 | 效果 |
|------|------|
| ≤520px | Row 换行，控件独占第二行 |
| ≤760px | PluginManager 单列 |
