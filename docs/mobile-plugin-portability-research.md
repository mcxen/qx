# Qx 插件无缝运行于 Android / iOS — 架构调研

> 状态：**Research** · 适用版本：v0.6.54+ · Owner：Core · 日期：2026-08-03  
> 性质：决策前调研，**不是**实现规格。落地时再拆 PR 计划与契约冻结。

## 0. 问题定义

Qx 桌面端（macOS / Windows，Tauri + React）已形成稳定的**市场插件模型**：

```text
.qx-plugin (manifest + index.js + assets)
        │
        ▼
context.* 端口（http / storage / ui.mountWorkbench / invoke / …）
        │
        ▼
PluginHost + 权限 + Workbench 投影
        │
        ▼
QxShell + Rust 领域服务 + 平台适配
```

目标：

1. **同一份插件包**（或极小差异）在 Android / iOS 上可用；
2. 作者继续写 **业务数据 + 声明式 UI**，不写第二套 Android/iOS UI；
3. 宿主在移动端保持 **安全、可审核、可商店上架**；
4. 与现有 SOLID / 端口原则一致：插件依赖契约，不依赖 Tauri / iframe 细节。

非目标（本调研不承诺）：

- 桌面全局快捷键、系统托盘、CLI、DDC 显示器、完整录屏等 **桌面专属能力** 在手机 1:1 复刻；
- 把 Custom DOM 面板原样搬进 App Store / Play Store 无审核成本。

---

## 1. 现状资产与可迁移性

### 1.1 已经利于跨端的部分

| 资产 | 为何利于移动 |
|---|---|
| **`context.*` 窄端口** | 插件不直接碰 OS API；移动端只需实现同一端口表 |
| **Workbench 声明模型** | List / Detail / Form / Actions / tabs/filters 是数据，不是 DOM |
| **Manifest + permissions** | 安装时能力声明，可映射到移动权限与商店隐私声明 |
| **JS 单入口 `index.js`** | 语言统一；移动 WebView / JS 引擎可复用 |
| **第一方插件业务模式** | 酷安/微博/贴吧/V2EX/天气等以 HTTP + 缓存 + List/Detail 为主，天然跨端 |

### 1.2 桌面专属或难迁移的部分

| 能力 | 移动端策略建议 |
|---|---|
| `context.cli` / 本机 shell | **不可用** → 明确 `capability unavailable` |
| 全局快捷键 / 托盘 / Island 浮岛全套 | 降级为通知 / 小组件 / App 内底栏状态 |
| `invoke:v2ex_*` 等宿主命令 | 需 **能力矩阵**：移动端实现子集，或改纯 `http` |
| iframe + postMessage 沙箱 | 移动端可改为 **WKWebView / Android WebView** 或 **进程内 JS 引擎** |
| Custom HTML Panel | **不作为移动端一等公民**；强制 Workbench |
| 文件系统任意路径 / Homebrew | 沙箱目录 + SAF / Files 选择器 |

### 1.3 插件可移植性分级（建议写进契约）

| 级别 | 条件 | 移动端 |
|---|---|---|
| **P0 Portable** | 仅 Workbench + http + storage + open-url + notifications + 可选 clipboard | 目标默认可用 |
| **P1 Host-assisted** | 额外 `invoke:*` 有官方移动实现 | 按 manifest `platforms` 启用 |
| **P2 Desktop-only** | 依赖 cli / tray / 录屏 / 外接显示器等 | 市场标记桌面 only，安装时过滤 |

第一方插件迁移顺序建议：V2EX / weather / sysinfo(子集) / 社区 Feed 类 → 后做需要 CLI 的 brew 等。

---

## 2. 核心结论（先看）

1. **插件无缝复用的关键不是 UI 框架选型，而是「移动端 Plugin Host 实现同一 `context.*` + Workbench 契约」。**  
   业务插件已经朝这个方向收敛；继续禁止插件画第二套 chrome。

2. **推荐中长期架构：  
   「共享 Rust 内核（领域 + 插件运行时） + 共享 TS 插件包 + 分平台 Shell（桌面 Tauri WebView / 移动原生壳或 Tauri Mobile）」。**

3. **短期最省事、且与现状同构的路径：Tauri 2 Mobile（Android/iOS WebView 壳）+ 同一套 React Shell 子集。**  
   中长期若商店体验 / 性能 / 审核吃紧，再把 **Shell 换成 SwiftUI / Compose**，但 **Workbench 渲染与 `context` 实现保留**。

4. **不要** 让每个插件写 Flutter / RN / KMP UI；那样会失去「一个 `.qx-plugin` 多端」的产品定义。

5. **Custom DOM / Raycast 兼容面板** 不作为移动战略路径；移动仅 Workbench + no-view 命令。

---

## 3. 候选架构对比

### 3.1 方案 A — Tauri 2 Mobile（推荐作为 Phase 1）

```text
同一 React QxShell（精简）
        │
同一 PluginHost / Workbench / RPC
        │
Tauri 2 WebView（Android / iOS）
        │
共享 Rust crates（插件安装、http、storage、部分 invoke）
```

| 维度 | 评价 |
|---|---|
| 与现状对齐 | **最高**：IPC、权限、插件包几乎可复用 |
| 开发成本 | 中：需处理移动生命周期、安全区、键盘、后台限制 |
| 插件无缝 | **高**：index.js 与 manifest 基本不动 |
| 商店体验 | 中：仍是 WebView 壳，需打磨原生感 |
| 风险 | Tauri mobile 成熟度、iOS 审核对「可下载代码」的限制 |

**iOS 关键点（必读）**：App Store 对「从网络下载并执行代码」敏感。策略见 §5。

**适用**：快速验证「同一插件包可装可跑」；桌面/移动共享最大代码面。

---

### 3.2 方案 B — Capacitor / 纯 Web 壳

类似 Ionic：前端打包进 WebView，原生插件桥少量 API。

| 维度 | 评价 |
|---|---|
| 对齐度 | 中高（前端可复用），但 **Rust 领域层要重写或变 HTTP 后端** |
| 成本 | 前端快，后端能力重复建设多 |
| 无缝插件 | 高（若 Host 仍是 TS） |
| 问题 | 与现有 Tauri/Rust 双轨，长期分叉 |

**结论**：仅当前端已完全不依赖 Rust 时值得；Qx 深度依赖本机服务，**不推荐作主路径**。

---

### 3.3 方案 C — React Native / Expo

| 维度 | 评价 |
|---|---|
| 原生感 | 好于 WebView |
| 插件模型 | 需 **JS 运行时 + 自研 Workbench 原生组件映射** |
| Rust | 可通过 RN 桥或独立模块调用，但工程复杂 |
| 无缝 | 中：Workbench 要重做成 RN 组件树 |

**结论**：若未来放弃 Web Shell、全面原生列表性能，可作 Phase 2 Shell 替换；**不是起步最优**。

---

### 3.4 方案 D — Kotlin Multiplatform + Compose / SwiftUI（双 UI）

共享：KMP 或 Rust（via FFI）业务 + 插件协议。  
UI：Android Compose / iOS SwiftUI 各自实现 Workbench。

| 维度 | 评价 |
|---|---|
| 体验 | 最佳原生 |
| 成本 | **最高**（两套 UI + 桥） |
| 插件 | JS 仍要嵌引擎（QuickJS / Hermes / WKWebView） |
| 无缝 | 高（若契约稳） |

**结论**：**体验终局候选**，不宜作为第一版；契约稳定后再做。

---

### 3.5 方案 E — Flutter

一套 UI 多端，但与现有 React/Rust/Workbench **技术栈正交**，插件 Host 与主题体系全重做。

**结论**：除非全产品迁 Flutter，否则 **否决** 作为 Qx 插件宿主。

---

### 3.6 方案 F — 仅「远程控制桌面 Qx」的薄 App

手机不做插件运行时，只推送/查看桌面会话。

**结论**：可做周边产品，**不满足**「插件在安卓/iOS 无缝使用」。

---

## 4. 推荐分层架构（目标态）

与桌面一致，把移动端也压成同一逻辑分层：

```text
┌─────────────────────────────────────────────┐
│  Mobile Shell（Phase1: Tauri WebView UI     │
│               Phase2?: SwiftUI/Compose）    │
│  - 启动器 / 模块导航 / 安全区 / 手势 / 主题   │
└───────────────────┬─────────────────────────┘
                    │ Workbench 投影 + Actions
┌───────────────────▼─────────────────────────┐
│  Plugin Host（共享 TS 或共享协议实现）        │
│  - 装载 .qx-plugin                          │
│  - 权限门控                                  │
│  - context.* RPC                             │
│  - mountWorkbench 状态归一化                  │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│  Plugin Runtime                              │
│  - 执行 index.js（WebView 隔离页 或 JS 引擎） │
│  - 禁止裸 DOM chrome；仅 Workbench 数据       │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│  Domain Core（优先 Rust 共享 crate）          │
│  - storage 命名空间 / 网络 / 缓存 / 部分 invoke│
│  - 平台适配：Android / iOS / desktop cfg     │
└─────────────────────────────────────────────┘
```

### 4.1 契约冻结（移动/桌面共用）

必须保持 **版本化** 的公共契约（建议 `plugin_protocol_version`）：

1. **Manifest**（platforms 含 `android` / `ios`，capabilities 分级）  
2. **Workbench JSON**（现有 `workbenchTypes` 为真源）  
3. **context RPC 方法表**（成功/错误形状一致）  
4. **权限枚举** 与「不可用」错误码  
5. **包格式** `.qx-plugin` zip + checksum  

桌面已有实现即规范；移动只做 **实现**，不发明第二套字段名。

### 4.2 能力矩阵（示例）

| Port | Desktop | Android | iOS |
|---|---|---|---|
| `ui.mountWorkbench` | ✅ | ✅ 目标 | ✅ 目标 |
| `http` | ✅ | ✅ | ✅（ATS 配置） |
| `storage.persist/session` | ✅ | ✅ App 沙箱 | ✅ App 沙箱 |
| `open-url` | ✅ | ✅ | ✅ |
| `notifications` | ✅ | ✅ | ✅ 需授权 |
| `clipboard` | ✅ | ✅ | ✅ 受限 |
| `island` | ✅ | ⚠️ 通知/前台服务降级 | ⚠️ Live Activity / 通知降级 |
| `cli` | ✅ | ❌ | ❌ |
| `tray` | ✅ | ❌ | ❌ |
| `invoke:v2ex_*` | ✅ | ✅ 可共享 Rust | ✅ 可共享 |
| `invoke` 录屏/全局快捷键 | ✅ | ❌ / 有限 | ❌ |

插件在 `manifest.platforms` 与 `permissions` 上声明；宿主在运行时 **Liskov 式** 返回「不可用」而不是崩溃。

---

## 5. iOS / Android 平台约束（架构必须提前吃）

### 5.1 iOS — 可下载插件与审核

- **Guideline 2.5.2 / 解释权**：从服务器下载并执行代码常被拒，尤其「插件商店内动态下发任意逻辑」。  
- 可行合规策略（需法务/审核经验复核，按严格度递增）：

| 策略 | 含义 | 对 Qx 的影响 |
|---|---|---|
| **A. 随 App 内置 + TestFlight 更新** | 插件打进 app bundle，随发版更新 | 市场动态安装弱化 |
| **B. 仅加载签名插件 + 域名白名单** | 类似扩展，但仍可能被质疑 | 需强签名与审核说明 |
| **C. 插件 = 数据驱动配置** | 逻辑在 App 内，远程只下发 feed 列表等数据 | 失去通用 JS 插件 |
| **D. 欧区/侧载 / 企业分发** | 非全量 App Store 路径 | 覆盖有限 |

**务实建议**：

- App Store 版：**内置 + 自有 CDN 下发「已审核插件清单」**，运行 **解释型 JS 业务** 时准备审核材料（用途、权限、不执行任意原生代码）。  
- 同步提供 **侧载 / 国际版** 完整市场（若产品策略允许）。  
- 技术上保持「可动态装包」，产品上可按渠道关闭市场安装。

### 5.2 Android

- 动态加载 JS/WebView 相对宽松，但仍需隐私政策、后台限制（Android 12+）、前台服务类型。  
- Play 对「其他应用安装器」类敏感；Qx 插件不是 APK 即可降低风险。  
- 文件访问用 SAF；后台刷新用 WorkManager，对齐桌面 RSS 后台调度语义。

### 5.3 安全共同项

- 插件仍在沙箱：无通用 FS、无任意 deep link 到私有 API。  
- 权限最小化；`http` 可演进为域名 allowlist（参见既有 plugin-design-research）。  
- 包校验：checksum + 签名链与桌面市场一致。

---

## 6. 运行时：插件 JS 在移动端怎么跑

| 方式 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| **WebView 子页 + postMessage**（对齐现 iframe） | 与桌面一致、隔离好 | 内存/生命周期重 | **Phase 1 首选** |
| **QuickJS / Hermes 嵌原生** | 轻、可控 | 无 DOM；Custom Panel 直接废 | Phase 2 对 P0 插件友好 |
| **主 WebView 同页执行** | 简单 | 隔离差、XSS 面大 | 否决 |

Workbench-only 插件 **不需要 DOM**；长期可用 JS 引擎 + 纯 JSON RPC，进一步减小攻击面与审核疑虑（「非下载原生代码，仅脚本驱动声明 UI」）。

---

## 7. UI / 交互在移动端的映射

桌面 QxShell 三段式在手机上建议：

```text
Desktop                         Mobile
Top Bar 搜索+筛选       →       顶栏搜索 + 横向 chip/筛选 sheet
Main List + Detail      →       列表全屏；点进详情页（导航栈）
Context Actions         →       底栏主按钮 + ⋯ ActionSheet
Bottom Island           →       轻量进度条 / Snackbar / 通知
Esc 阶梯                →       系统返回手势 / 导航返回（同阶语义）
Cmd/Ctrl+K              →       长按 / ⋯ 菜单
```

**原则**：语义端口不变（open detail / back / primary action），**控件换皮**。  
这与当前「插件不画 chrome」完全一致。

密度：移动列表用触控行高；Workbench 字段无需插件改代码。

---

## 8. 工程与仓库策略

### 8.1 单仓 monorepo（推荐）

```text
Qx/
  src/                 # 桌面 + 可共享 TS（plugin host、workbench types）
  src-tauri/           # 桌面 + mobile target（cfg 分平台）
  crates/              # 抽离 pure Rust：plugin_install、http_cache、v2ex…
  mobile/              # 若 Phase2 原生壳，放 Android/iOS 工程
  qx-plugins/          # 插件源（已 submodule/邻仓）
  docs/
```

- **共享**：`workbenchTypes`、权限枚举、RPC schema、Rust 领域 crate。  
- **不共享**：窗口管理、全局快捷键、托盘。

### 8.2 开发体验

| 需求 | 做法 |
|---|---|
| 插件热重载 | 桌面已有 dev watcher；移动用 USB/局域网装本地 `.qx-plugin` |
| 真机调试 | Android logcat + Safari Web Inspector / Chrome inspect WebView |
| 契约测试 | 对 Workbench fixture + RPC 做 golden test，桌面/移动 CI 共用 |
| 第一方插件 CI | `platforms` 矩阵：desktop smoke + mobile host mock |

### 8.3 语言分工建议

| 层 | 语言 | 原因 |
|---|---|---|
| 插件业务 | JS | 已有生态与作者习惯 |
| 宿主 UI Phase1 | TS/React | 复用 Shell/Workbench 投影 |
| 领域/安装/网络 | Rust | 与桌面一致，安全与复用 |
| 宿主 UI Phase2（可选） | Swift / Kotlin | 极致原生时再上 |

**不推荐** 为移动插件引入第二业务语言（Dart/Kotlin 写插件）。

---

## 9. 分阶段路线图（建议）

### Phase 0 — 契约与插件卫生（现在就能做，桌面收益）

- 清单化第一方插件：P0 / P1 / P2。  
- Manifest 增加 `platforms: ["macos","windows","android","ios"]` 与可选 `mobile.unsupportedPermissions`。  
- 禁止新插件 Custom DOM；存量迁 Workbench（V2EX 已示范）。  
- 文档：作者指南增加「移动可移植性检查表」。

### Phase 1 — Tauri Mobile MVP（3–6 个月量级，视人力）

- Android 优先（审核与 WebView 调试更简单）→ 再 iOS。  
- 实现：安装插件、Workbench 列表详情、http/storage、1–2 个第一方插件（V2EX / weather）。  
- 启动器子集：搜索已装插件 + 打开 panel。  
- 明确 cli/tray 不可用。

### Phase 2 — 体验与系统整合

- 通知、分享表、深链 `qx://plugin/...`。  
- 后台刷新（RSS 类）用系统调度器。  
- Island 语义降级。  
- 性能：长列表虚拟化、图片缓存对齐桌面。

### Phase 3 — 可选原生 Shell

- 若 WebView 体验不够：SwiftUI/Compose 重画 Shell + Workbench，**RPC/插件包不动**。  
- 插件作者无感。

---

## 10. 与「好的 iOS / Android 开发方法」直接对应的答案

| 问题 | 建议 |
|---|---|
| 用什么做 App？ | **先 Tauri 2 Mobile + 现有 React/Rust**；不是先开 Flutter 新坑 |
| 插件怎么写才无缝？ | **只依赖 Workbench + context.\***；把桌面专属放 optional |
| 要不要 Kotlin/Swift 写插件？ | **不要**；宿主可以用原生，插件保持 JS 包 |
| 双端 UI 框架怎么选？ | 共享 **声明式 Workbench**，不共享像素级 DOM |
| 最大风险？ | **iOS 动态代码审核** + 桌面能力在移动上的错误预期 |
| 成功判据？ | 同一 `v2ex.qx-plugin` 在桌面与 Android 安装后，列表/详情/刷新行为一致 |

### 10.1 方法论文（团队怎么干）

1. **契约驱动**：先冻 Workbench/RPC，再写移动 Host。  
2. **能力降级合法化**：不可用端口稳定错误，插件 `if (!available)` 或 manifest 过滤。  
3. **第一方插件当样板**：每个插件 README 标注 Portable 级别。  
4. **桌面继续是能力超集**；移动是子集，而不是分叉协议。  
5. **商店包与「完整市场包」可双轨**，代码一套，feature flag 控制动态安装。

---

## 11. 竞品/类比（帮助建立直觉）

| 产品 | 模式 | 对 Qx 的启示 |
|---|---|---|
| Raycast | 仅桌面 | 插件 API 强，但无移动；Qx 若做移动是差异化 |
| Shortcuts / App Intents | 系统编排 | 移动侧重「动作与自动化」，可映射 no-view 命令 |
| 浏览器扩展 MV3 | 声明能力 + 审核 | 权限与远程代码策略可参考 |
| Zed WASM 扩展 | 强沙箱 | 长期可用 WASM 替 JS（非必须） |
| 淘宝/微信小程序 | 宿主组件 + 受限 API | **Workbench = 小程序组件模型** 的直觉对应 |

Qx 的正确类比不是「再做一个 RN 社区 App」，而是 **「移动端也有一个小程序式宿主，包格式是 .qx-plugin」**。

---

## 12. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| iOS 拒审动态插件 | 市场核心受阻 | 内置清单 + 签名；渠道分包 |
| Tauri mobile 不成熟 | 进度不稳 | Phase1 仅 Android；Core 抽 crate 降低耦合 |
| 插件滥用 desktop invoke | 移动崩溃/空洞 | 能力矩阵 + 安装过滤 |
| WebView 性能 | 长列表卡顿 | 虚拟列表、图片预算、引擎化 Phase2 |
| 两套 UI 分叉 | 维护爆炸 | 禁止插件自绘；Shell 换皮不换契约 |
| 后台策略差异 | RSS/通知行为不一致 | 用「目标语义」文档约束，不保证同时刻 |

---

## 13. 建议决策（供评审）

| 决策项 | 建议 |
|---|---|
| 是否做移动？ | 值得：插件模型已具备跨端形状 |
| Phase 1 技术栈 | **Tauri 2 Mobile + 共享 Plugin Host/Workbench + 共享 Rust 子集** |
| 插件作者约束 | **Workbench-only = 移动入场券** |
| Custom DOM | 桌面遗留；移动不支持 |
| 原生双 UI（Swift/Compose） | 仅 Phase 3，契约稳定后 |
| Flutter | 不做 Qx 主宿主 |
| 下一步工程 | Phase 0 契约与第一方插件分级（无移动代码也可交付价值） |

---

## 14. 参考文档（仓库内）

- [`public/doc/plugin-system.md`](../public/doc/plugin-system.md) — 端口与依赖方向  
- [`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md) — 作者模型  
- [`public/doc/plugin-ui-guidelines.md`](../public/doc/plugin-ui-guidelines.md) — Workbench / Actions  
- [`docs/plugin-architecture.md`](./plugin-architecture.md) — 桌面 Host 实现  
- [`docs/architecture-principles.md`](./architecture-principles.md) — SOLID / 端口  
- [`docs/plugin-design-research.md`](./plugin-design-research.md) — 桌面插件生态横向调研（历史）  
- [`docs/module-port-inventory.md`](./module-port-inventory.md) — 第一方能力与缺口  

---

## 15. 开放问题（需产品拍板）

1. 移动端 Qx 是 **完整启动器** 还是 **插件运行器 + 少量内置**？  
2. App Store 是否接受 **动态插件市场**，还是仅 **内置扩展包**？  
3. 与桌面是否 **同一账号/同一市场源/同一设置同步**？  
4. 第一优先平台：**Android 还是 iOS**？  
5. 是否要做 **平板分栏**（更接近桌面 master-detail）？

---

## 16. 一句话

> **把 Qx 插件当成「声明式小程序」：业务 JS + Workbench 数据契约；桌面与移动都只是 Host。**  
> 移动端优先用 **Tauri Mobile 复用 Host**，用 **能力矩阵** 砍桌面专属，用 **商店合规策略** 约束动态加载——而不是让每个插件重写成原生 App。
