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

**渐进策略**：先在主面板/app.css 层实现完整变量系统，再逐步替换各子组件的内联颜色。