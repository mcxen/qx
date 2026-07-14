# Settings & About 面板

> 开发者文档。描述 Qx 设置/关于面板的结构、设计令牌、Row/Card 规范、响应式断点，以及新增一个 tab 的标准步骤。

## 1. 结构图

```
QxShell (visual="elevated", has-context)
├─ qx-shell-topbar           搜索 + 标题 + trailing
├─ qx-shell-main (grid)
│  ├─ main.qx-shell-content
│  │  └─ SettingsPanel
│  │     ├─ .qx-settings-title
│  │     └─ .qx-settings-body
│  │        └─ ScrollArea.qx-settings-scroll   ← 非 plugins tab
│  │           └─ .qx-settings-page
│  │              └─ SettingsCard[]             ← shadcn Card
│  │                 ├─ CardHeader (title + description + trailing)
│  │                 └─ CardContent
│  │                    └─ Row[]                ← 单条设置项
│  └─ aside.qx-shell-context
│     └─ nav.qx-settings-sidebar
│        ├─ .qx-settings-nav-group × 4
│        └─ Button.qx-settings-nav-item × 10
└─ qx-shell-bottom-island
```

- `QxShell` 见 `src/components/QxShell.tsx`，主区域用 grid `minmax(0, 1fr) var(--qx-context-w)` 切分。
- 侧边栏宽度由 `--qx-context-w: clamp(240px, 28vw, 340px)` 决定，因此内容区随窗口宽度自适应。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `src/modules/settings/SettingsPanel.tsx` | 顶层布局、tab 路由、ScrollArea 包裹 |
| `src/modules/settings/AboutPanel.tsx` | 关于页：版本信息 + 存储详情 |
| `src/modules/settings/AgentSettings.tsx` | AI Agent 设置，分 4 张 Card |
| `src/modules/settings/GeneralSettings.tsx` | 通用设置 + **Module Search** 开关 |
| `src/modules/settings/GeneralSettings.tsx` 等 | 其他 tab |
| `src/modules/settings/PluginManager.tsx` | Extensions 页：Installed/Browse、扩展详情、Commands/Shortcuts/Preferences |
| `src/components/ui.tsx` | `Row` / `SettingsCard` / `Toggle` / `Select` / `Slider` / `Input` 等 |
| `src/components/shadcn/card.tsx` | shadcn Card primitive |
| `src/styles/settings-actions.css` | 设置面板所有 CSS（含 Card 视觉） |
| `src/styles/shared-modal.css` | `.qx-settings-row-control` 共享样式 |
| `src/styles/base.css` | 设计令牌 |

## 3. 设计令牌

均定义在 `src/styles/base.css`，浅色/深色两套：

| 令牌 | 用途 |
|---|---|
| `--qx-border-1` / `--qx-border-2` | 一级/二级分隔线 |
| `--qx-card-radius` (8px) | Card 圆角 |
| `--qx-control-radius` (6px) | 输入/按钮圆角 |
| `--qx-accent` / `--qx-accent-soft` | 主题色 + 软高亮 |
| `--qx-text-primary` / `secondary` / `tertiary` | 三级文字 |
| `--card` | Card 背景（指向 `--qx-bg-component-1`） |
| `--qx-context-w` | 侧边栏宽度 `clamp(240px, 28vw, 340px)` |
| `--qx-scrollbar-thumb` | 滚动条拇指色 |

## 4. Row / Card / SettingsCard 规范

### `Row`（单条设置项）
```tsx
<Row title="标题" description="可选说明">
  <Toggle value={v} onChange={...} />   {/* 右侧控件 */}
</Row>
```
- 布局：`display: flex; justify-content: space-between`，左标题 + 右控件。
- 控件列 `.qx-settings-row-control` 默认 `flex-shrink: 0; min-width: 0`，窄窗下（`max-width: 520px`）换到第二行独占。
- 一行只放一个语义单位（开关、单选、单输入）；多控件请拆成多 Row，或用 `.qx-agent-inline-toggles` 横向排列。

### `SettingsCard`（一组相关设置）
```tsx
<SettingsCard title="组名" description="组说明" trailing={<可选右上角元素/>}>
  <Row .../>
  <Row .../>
</SettingsCard>
```
- 内部基于 `Card` + `CardHeader` + `CardContent`，已加 `.qx-card` class 接 CSS。
- 一张 Card 内最后一行自动去掉底部分隔线（`.qx-card-body .qx-settings-row:last-child { border-bottom: none; }`）。
- 多张 Card 之间由 `.qx-settings-page` 的 `gap: 12px` 自动留白，**不要**手动加 `margin-top`。

### 何时直接写 div
- 装饰元素（如关于页顶部 GIF 头）。
- 列表项（如存储 bucket 行）有自定义 grid 时——不要硬塞进 Row。
- PluginManager 有自己的两列响应布局，**不要**用 SettingsCard 包。

## 5. 响应式断点

| 断点 | 触发条件 | 效果 |
|---|---|---|
| `max-width: 520px` (media) | 窗口宽度 ≤ 520 | `.qx-settings-row` 换行；`.qx-settings-row-control` 占满第二行 |
| `max-width: 560px` (container) | `.qx-storage-list` 容器宽度 ≤ 560 | 存储 bucket 行从 3 列 grid 退化为 1 列堆叠 |
| `max-width: 760px` (media) | 窗口宽度 ≤ 760 | PluginManager 双列变单列 |
| `auto-fit minmax(160px, 1fr)` | 任意宽度 | Agent provider/model 双 select 自动换列，永不溢出 |

容器查询（`@container`）只对带 `container-type: inline-size` 的祖先生效。当前只有 `.qx-storage-list` 启用。

## 6. 新增 tab 步骤

1. 在 `src/modules/settings/store.ts` 的 `SettingsTab` 联合类型加新 id：
   ```ts
   export type SettingsTab = ... | "myfeature";
   ```
2. 在 `SettingsPanel.tsx` 的 `NAV_GROUPS` 合适分组里加一项：
   ```ts
   { id: "myfeature", label: "My Feature", icon: Sparkles },
   ```
3. 在 `TAB_LABELS` 加同名映射。
4. 在 `renderContent()` 的 switch 加 case：
   ```tsx
   case "myfeature":
     return <MyFeatureSettings />;
   ```
5. 新建 `src/modules/settings/MyFeatureSettings.tsx`，模板：
   ```tsx
   import { Row, SettingsCard, Toggle } from "../../components/ui";
   import { useSettingsStore } from "./store";
   import { useT } from "../../i18n";

   export default function MyFeatureSettings() {
     const { settings, patch } = useSettingsStore();
     const t = useT();
     const m = settings.myFeature;   // 需要先在 store 里加默认值与接口

     return (
       <div className="qx-settings-page">
         <SettingsCard title="My Feature" description="...">
           <Row title="Enable" description="...">
             <Toggle value={m.enabled} onChange={(v) => patch("myFeature", { ...m, enabled: v })} />
           </Row>
         </SettingsCard>
       </div>
     );
   }
   ```
6. （可选）在 `src/i18n.ts` 加对应 i18n key。

## 7. 已知约束

- **Input 自适应**：原生 `<input style={{ width: N }}>` 会撑爆窄窗。必须用 shadcn `Input` 包在 `.qx-settings-input-wrap` 里，CSS 自动 `max-width: 280px` 且 `min-width: 0`。
- **永不硬编码 min-width**：曾用 `min-width: min(360px, 46vw)` 在 AgentSettings 上，在 480 窗口下溢出。改用 `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`。
- **`.qx-settings-row-control` 默认 `flex-shrink: 0`**：内部嵌套的 Input 需要外层加 `min-width: 0` 才能正常收缩。
- **存储 bucket 行的 `auto` 列只长不缩**：4 列 grid 中两个 `auto` 列会挤掉中间 `1fr`。已合并为 3 列 `auto / 1fr / auto`，把 meta + actions 放进同一右侧 `.qx-storage-row-side`。
- **PluginManager 自管滚动**：不要把它包进 `ScrollArea`，它有自己的两列内部 scroll。

## 8. 验证清单

新增/修改设置 tab 后，请在以下窗口宽度下手动检查：

- 480×360（最小）—— 内容不溢出、不裁剪；存储行正确堆叠；Agent select 退化为单列。
- 980×576（默认）—— Card 间距均匀，所有控件可见。
- 1280×800 —— 内容铺满，无大片空白。
- 1500×900 —— 无横向溢出，max-width 约束生效。

`npx tsc --noEmit` 与 `npm run build` 必须双绿。
