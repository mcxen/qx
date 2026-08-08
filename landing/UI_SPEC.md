# Qx Landing — UI Spec

落地页（`landing/`）的视觉、文案与实现约定。改 `index.html` 或扩展站点结构前先读本文。

> **范围**：对外营销 / 下载落地页（Cloudflare Pages 等静态托管）。
> **不在此范围**：桌面应用壳与模块 UI → 根目录 [`UI_SPEC.md`](../UI_SPEC.md)。
> **近亲参考**：插件商店 [`qx-plugins-clone/store/src`](../../qx-plugins-clone/store/src) 的克制表面；Vercel design / Geist 的层次与克制原则。

---

## 1. 产品与实现边界

| 项 | 约定 |
| --- | --- |
| 入口 | 单页 `landing/index.html`（CSS + i18n + 交互内联） |
| 部署 | `wrangler.toml` → `pages_build_output_dir = "."` |
| 品牌资源 | `qx-tray.svg`；概念图在 `assets/`（非必须上屏） |
| 依赖 | 允许 Google Fonts（Geist / Geist Mono）；禁止额外框架、图标包、分析脚本 |
| 宿主语言 | 语义化 HTML + CSS 变量 + 小段原生 JS |

保持**可单文件交付**。未出现多页/构建需求前，不拆 Vite 工程。若拆分，须同步更新本文与部署配置。

---

## 2. 设计原则

按优先级保护：

1. **事实准确**：版本、平台、安装方式、许可表述与 README / Releases 一致。
2. **读者任务**：先回答「Qx 是什么、能做什么、如何安装」。
3. **克制权威**：冷静、直接、技术向；用层次与对齐建立可信，不用促销话术。
4. **同一语法**：全页一套 token、字号阶梯、细线网格；明暗两主题等价层级。
5. **可删则删**：任意表面、边框、图标、段落若去掉仍不损意义，则删除。

### 2.1 必须

- 首屏给出身份 + 主张 + 主 CTA（下载）+ 可感知的产品示意。
- 功能区用**真实能力**（搜索、剪贴板、截图录屏、RSS、QxAI、插件/Island），一句说明即可。
- 明暗主题完整：系统偏好 + 可选手动覆盖，且对比度达标。
- 中英文完整：用户可见字符串进字典，切换无漏译。
- 焦点可见、跳过链接、语义标题顺序、`prefers-reduced-motion` 尊重。

### 2.2 禁止

- 全大写 / 宽字距 **eyebrow / kicker / 装饰编号标签**（如 `01 / PRODUCT SURFACE`）。
- 装饰性渐变、光晕、blob、玻璃拟态、无意义大阴影。
- 居中营销 Hero + 大卡片墙的默认 SaaS 模板感。
- 嵌套卡片、用边框补救层级。
- 彩色 icon 方块装饰、混搭图标风格。
- 假截图、库存图、AI 插画充当证据。
- 文案套路：「不是 A，而是 B」「少一点 X，多一点 Y」。
- 破折号堆砌、空话形容词（「革命性」「极致」「沉浸」）。
- 仅深色或仅浅色可用的样式。

---

## 3. 信息架构

固定章节顺序（可增补，勿打乱主路径）：

| 顺序 | 区块 | 职责 |
| --- | --- | --- |
| 0 | Header | 品牌、锚点导航、商店/GitHub、下载、语言、主题 |
| 1 | Hero | 主张、lede、下载/功能 CTA、热键提示、启动器 demo |
| 2 | Features | 6 项能力网格（细线 1px 分隔） |
| 3 | Workflow | 键盘四步：唤起 → 搜索 → 执行 → 返回 |
| 4 | Install | 平台 / 技术栈 / 许可 + Homebrew + Releases / CNB |
| 5 | Extensions | 插件商店与开发文档 callout |
| 6 | Footer | 版权、外链、回顶 |

锚点 id：`#top` `#features` `#workflow` `#install` `#extensions`。

---

## 4. 布局与密度

| Token / 规则 | 值 |
| --- | --- |
| 内容最大宽 | `--max: 1080px` |
| 水平 padding | `--pad: clamp(20px, 4vw, 32px)`（窄屏 18px） |
| Header 高度 | `--header-h: 56px`，sticky + 毛玻璃底 |
| Section 纵向 | `padding: clamp(56px, 9vw, 96px) 0` |
| 区块分隔 | 仅用 `1px solid var(--border)`，不用色带装饰 |
| 圆角 | `--radius-sm: 6px` · `--radius: 8px` · `--radius-lg: 12px` |
| 动效 | `--duration: 160ms` · `--ease: cubic-bezier(0.23, 1, 0.32, 1)` |

### 断点

| 宽度 | 行为 |
| --- | --- |
| ≥ 960px | Features 三列 |
| ≥ 720px | Features 两列；Install strip 三列 |
| ≤ 880px | Hero 单列；Workflow 单列 |
| ≤ 640px | 导航收入菜单；步骤 kbd 折行；callout 单列 |

网格子项一律 `min-width: 0`，优先 reflow，禁止横向撑破。

---

## 5. 颜色与主题

### 5.1 语义 token（禁止在业务样式硬编码新灰阶）

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#fafafa` | `#0a0a0a` |
| `--bg-elevated` | `#ffffff` | `#111111` |
| `--bg-hover` | `#f4f4f4` | `#161616` |
| `--bg-muted` | `#f2f2f2` | `#141414` |
| `--text` | `#171717` | `#ededed` |
| `--text-secondary` | `#666666` | `#a1a1a1` |
| `--text-tertiary` | `#8f8f8f` | `#6b6b6b` |
| `--border` | `#eaeaea` | `#1f1f1f` |
| `--border-strong` | `#d4d4d4` | `#2e2e2e` |
| `--accent` | `#171717` | `#ededed` |
| `--accent-fg` | `#fafafa` | `#0a0a0a` |

Demo 窗体另有 `--demo-*` 一套，跟随主题，保持「产品内表面」与页面背景可区分。

### 5.2 主题行为

| 机制 | 说明 |
| --- | --- |
| 默认 | 跟随 `prefers-color-scheme`（无 `data-theme` 时） |
| 手动 | `html[data-theme="light"|"dark"]` |
| 持久化 | `localStorage["qx-landing-theme"]` |
| 首屏防闪 | `<head>` 内联脚本：有持久化则立即写 `data-theme` |
| 控件 | Header 日/月按钮；`aria-label` / `title` 走 i18n |
| `color-scheme` | 与当前主题同步，保证原生控件观感 |

新增组件必须在 light / dark 下各看一遍：边框、hover、按钮主次、demo 对比。

---

## 6. 字体与排版

| 角色 | 字体 | 用法 |
| --- | --- | --- |
| 正文 / UI | Geist → Inter → PingFang SC → Microsoft YaHei → system-ui | 默认 15px / 400 / lh 1.5 / tracking `-0.011em` |
| 等宽 | Geist Mono → SF Mono → ui-monospace | kbd、版本感数字、aside、code |

### 字号阶梯（近似）

| 角色 | 规则 |
| --- | --- |
| Hero 标题 | `clamp(36px, 6vw, 56px)` · weight 560 · tracking ≈ `-0.045em` · lh ≈ 1.05 |
| Section 标题 | `clamp(24px, 3.5vw, 32px)` · weight 560 · tracking ≈ `-0.035em` |
| Lede | 15–16px · secondary 色 · max-width 约 36–48ch |
| 正文 / 功能说明 | 13–14px · secondary |
| Label / meta | 12–13px · tertiary · **不要**全大写拉距 |
| 导航 / 按钮 | 13px · weight 500–520 |

中英标题行长：中文 Hero 约 `12ch`；英文允许更宽（`html[lang="en"]` 可覆盖 `max-width`）。

---

## 7. 组件约定

### 7.1 Header

- 左：`Qx / desktop` + tray 图标。
- 右：`nav` · 语言切换 · 主题 ·（窄屏）菜单。
- 链接 hover：细边框 + `--bg-hover`，无下划线。
- 下载可作轻量描边按钮（`nav__download`），主 CTA 仍在 Hero。

### 7.2 按钮

| 变体 | 样式 |
| --- | --- |
| Primary | 实心 `--accent` / `--accent-fg`，高度 36px |
| Ghost | 透明底 + `--border`，hover 加强边框与 hover 底 |
| 交互 | `:active { transform: scale(0.98) }`；可见 `:focus-visible` |

禁止第三套彩色品牌按钮。

### 7.3 Features 网格

- 容器：`1px` 缝 + `border` + `border-radius: 12px`（对齐 store catalog）。
- 单元：标题 + 两位序号 + 一段说明；**不要**插图、不要进度假数据。
- Hover：仅背景微变。

### 7.4 Workflow 步骤

- 上边线列表：序号（mono）· 标题/说明 · `kbd`。
- 快捷键用平台通用示意（⌥ Space、↑↓、↵、⌘K、Esc）；Windows 用户在 lede/文档中可知 Ctrl 等价，落地页不强制双写。

### 7.5 启动器 Demo

- 静态示意即可：搜索条 + 可选中的结果行 + 底栏快捷键提示。
- 行点击更新 query 文案；选中态用边框 + active 底，**不要**彩色高亮条。
- 文案与 `data-query` 走 i18n。

### 7.6 Install / Callout

- Strip：三格事实（平台、技术栈、许可）。
- Homebrew 用 mono `code` 块，可横向滚动。
- Extensions callout：左文右简标（`Qx / store`），双 CTA。

### 7.7 kbd

细边框、elevated 底、mono 11px；明暗均可读。

---

## 8. 国际化（中 / 英）

| 项 | 约定 |
| --- | --- |
| Locale | `zh-CN` \| `en` |
| 检测 | `localStorage["qx-landing-locale"]` → 否则 `navigator.language`（`zh*` → 中文） |
| 控件 | `.lang-toggle`：`中文` / `EN`，`aria-pressed` |
| DOM | `data-i18n` 文本 · `data-i18n-html` 含标签 · `data-i18n-aria` · `data-i18n-title` · `data-query-key` |
| 同步 | `document.title`、`meta description`、`og:*` 随 locale |
| 字典 | 内联于 `index.html` 的 `dict`；**新增字符串必须双语同时加** |

### 文案语气

- 中文：短句、名词与动作直接；功能说明写「能做什么」，不写情怀。
- 英文：sentence case；产品名 `Qx` 固定；避免 marketing fluff 与 em dash 堆砌。
- 专有名保持原样：Tauri、Homebrew、WebView2、OpenRouter、DeepSeek、Island、Workbench。

---

## 9. 下载与外链

### 9.1 平台直链下载

Hero `#download` 与 Install 区共用同一套下载状态机：

| 项 | 约定 |
| --- | --- |
| 默认源 | **CNB**（国内镜像） |
| 可切换 | **GitHub** |
| 持久化 | `localStorage["qx-landing-download-source"]` = `cnb` \| `github` |
| 清单 | `{source}/releases/latest/download/latest.json` |
| macOS 包 | 优先 `qx_v{version}_aarch64-apple-darwin.dmg`（用户安装包） |
| Windows 包 | `artifacts[]` 中 `platform=windows` 的 `asset_name`，通常为 `Qx_{version}_x64-setup.exe` |
| 按钮 | **macOS** / **Windows** 分开展示；点击直达对应包 URL，开始下载 |
| 主次 | 按 UA 高亮当前平台（Mac → macOS 为 primary；Windows → Windows 为 primary） |
| 失败 | 文案提示；按钮退化为对应源的 Releases 列表页 |

CNB 资产基址：

```text
https://cnb.cool/v.ip/Qx/-/releases/download/{tag}/{asset_name}
https://cnb.cool/v.ip/Qx/-/releases/latest/download/latest.json
```

GitHub 资产基址：

```text
https://github.com/mcxen/qx/releases/download/{tag}/{asset_name}
https://github.com/mcxen/qx/releases/latest/download/latest.json
```

实现须从 `latest.json` 读取 `version` / `tag` / `artifacts`，禁止在页面写死版本号。
`latest.json` 中的 macOS 条目常为 updater 用 `.app.zip`；落地页面向用户时 **优先构造同版本 `.dmg` 文件名**（与 release-workflow 资产清单一致）。

### 9.2 macOS 未公证提示（安装区必含）

Install 区在下载按钮下方固定展示简短说明，不得省略：

| 项 | 约定 |
| --- | --- |
| 原因 | 开源、暂无稳定商业收入；发行包 **ad-hoc 签名、未 Apple 公证** |
| 现象 | Gatekeeper「无法验证开发者」/「已损坏」 |
| 解法 1 | 访达右键 → 打开 |
| 解法 2 | DMG 内 `bash install.sh` |
| 解法 3 | 终端 `xattr -dr com.apple.quarantine /Applications/Qx.app` |
| 语气 | 直接说明事实与步骤；中英均走 `data-i18n` |

### 9.3 其它外链

| 用途 | URL |
| --- | --- |
| 源码 | `https://github.com/mcxen/qx` |
| CNB Releases 页 | `https://cnb.cool/v.ip/Qx/-/releases` |
| GitHub Releases 页 | `https://github.com/mcxen/qx/releases/latest` |
| 插件商店 | `https://qxstore.xpai.uk` |
| 插件开发文档 | repo 内 `public/doc/plugin-development-guide.md`（GitHub blob main） |
| Homebrew | `brew tap mcxen/qx && brew install --cask qx` |

浏览型外链：`target="_blank"` + `rel="noreferrer"`。
平台包直链：同源下载导航即可，不强制新标签。
平台表述与 README 对齐：macOS 14+、Windows 10/11、Apple Silicon DMG、Windows x64 NSIS + WebView2。

---

## 10. 无障碍与动效

- 跳过链接 `.skip-link`。
- 单一 `h1`（Hero）；section 用 `h2` + `aria-labelledby`。
- 交互控件原生 `button` / `a`；菜单 `aria-expanded` / `aria-controls`。
- 可见 `:focus-visible`（边框或 outline）。
- `prefers-reduced-motion: reduce` 时关闭过渡与平滑滚动。
- 装饰性 SVG / 色点：`aria-hidden="true"`。

---

## 11. 文件与命名

```text
landing/
  UI_SPEC.md          ← 本文
  index.html          ← 唯一页面实现
  qx-tray.svg
  wrangler.toml
  assets/             ← 可选素材，默认不上屏
```

| 约定 | 说明 |
| --- | --- |
| 类名 | BEM 轻量：`block` / `block__el` / `block--mod` |
| 状态 | `is-open`、`is-active`、`is-paused` |
| 主题 | 仅 `html[data-theme]` + `prefers-color-scheme` 回落 |
| 语言 | 仅 `html[lang]` + 字典，不复制两套 HTML |

---

## 12. 改动检查清单

发版或合并落地页改动前：

- [ ] Light / Dark 各浏览首屏与 Features
- [ ] 中文 / EN 切换：导航、Hero、功能、用法、安装、扩展、页脚、demo 行
- [ ] 640px / 880px / 1080px+ 无横向溢出
- [ ] 主 CTA 与 Releases / CNB / Store 链接可点
- [ ] 未引入禁止项（渐变 blob、全大写 kicker、对仗文案）
- [ ] 新增文案已进 `dict["zh-CN"]` 与 `dict.en`
- [ ] 安装/平台事实与 README 一致

本地预览：

```bash
cd landing && python3 -m http.server 8787
# http://127.0.0.1:8787/
```

---

## 13. 与应用 UI_SPEC 的关系

| | 应用 `UI_SPEC.md` | Landing `UI_SPEC.md` |
| --- | --- | --- |
| 目标 | 原生桌面工具壳 | 静态产品页 |
| Token | Qx 透明表面 / shadcn 映射 | 网页黑白细线 / 明暗 solid |
| 密度 | 工具栏、列表、底栏 Island | 编辑式排版、宽呼吸 |
| 交互 | 键盘协议、Esc 层 | 锚点、语言/主题、外链 |

两套规范**不得互相覆盖**。若落地页嵌入真实应用截图，截图内容仍服从应用 UI；页面装裱服从本文。

---

## 14. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-08-07 | 初版：Vercel/store 克制风格重构后的落地页规范；中英与明暗主题 |
| 2026-08-07 | 平台直链：macOS / Windows 分端下载；默认 CNB，可切 GitHub |
| 2026-08-08 | 安装区补充 macOS 未公证说明与访达 / install.sh / xattr 三步解法 |
