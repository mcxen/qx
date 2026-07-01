# Raycast 类 Rust 启动器插件设计调研

面向 Qx 插件系统的下一阶段演进。本文横向对比若干「Raycast-like」/ 通用启动器项目的插件模型，抽出对我们有借鉴价值的具体做法与 Rust 生态可复用的组件。

**范围**：只讨论桌面级、以命令/结果为核心交互的启动器。不覆盖 IDE 插件、Alfred 之类闭源商业方案。

## 一、项目速览

| 项目 | 语言 / GUI | 插件执行模型 | Manifest / 权限 | 亮点 |
|---|---|---|---|---|
| **Raycast**（闭源，参照物） | Swift / AppKit | Node.js 子进程 + 静态导出 React 视图（在自渲染 UI 上映射） | `package.json` extension schema，`preferences` 强类型 | 商用体验基线；`AI Extensions`、Preferences、Store |
| **Vicinae** | C++ / Qt6 (Linux) | 类 Raycast 的 Node.js API，尽量兼容 Raycast 扩展 | 直接吃 Raycast 的 `package.json` schema | 可执行大部分 Raycast 扩展，验证「Raycast API → 非 macOS」可移植 |
| **Onagre** + **pop-launcher** | Rust (Iced) | 子进程 IPC（JSON-RPC over stdio），由 `pop-launcher` 派发 | TOML 插件描述 + 二进制路径 | 后端与前端解耦；子进程可用任意语言写 |
| **Ulauncher** | Python / GTK | 进程内 Python 插件 | JSON `manifest.json` + `preferences` | Preference 类型系统 (`input/checkbox/select`) 简单直接 |
| **Cerebro** | JS / Electron | 进程内 npm 包 | `package.json` + `cerebro-plugin` 关键字 | npm 生态即市场；无沙箱 |
| **Asyar** | TypeScript / Tauri | 进程内 JS（浏览器 API 子集） | TS 声明 + JSON manifest | Tauri 同栈，UI 用 Svelte |
| **Kunkun** | TS / Tauri | Deno 子进程 + Deno permissions | manifest 描述 API 权限；Deno 提供进程级隔离 | 用 Deno 的 `--allow-net --allow-fs=...` 作为默认沙箱 |
| **Loungy** | Rust / GPUI | 进程内 Rust trait 对象（编译期插件） | Cargo feature | 极致性能，但生态封闭 |
| **Zed extensions** | Rust / GPUI | **wasmtime + WIT component** 组件模型 | `extension.toml` + `schema_version`；主机侧显式暴露 host functions | Rust 生态目前最成熟的「WASM 组件 + capability」范式 |

其他值得看的通用运行时：**Extism**（多语言 WASM 插件框架、Host SDK 覆盖 Rust/Node/Go/Python 等）、**wasmtime + wit-bindgen**（component model 官方链路）、**rquickjs / boa_engine / deno_core**（Rust 内嵌 JS 三选）、**nucleo**（Helix 团队开源的 fuzzy matcher，Zed 也在用）。

## 二、执行模型对比

| 模型 | 代表 | 隔离粒度 | 冷启动 | 崩溃隔离 | 语言开放度 | 与 Qx 现状对齐度 |
|---|---|---|---|---|---|---|
| 进程内 JS/TS（Cerebro / Asyar / Ulauncher） | Cerebro | 无（同进程） | 极快 | 差 | 单语言 | 与我们现在 iframe 相似，但没沙箱 |
| **iframe + postMessage**（**Qx 现状**） | 无同类 | 浏览器沙箱 + CSP | 快 | 强（iframe 崩溃不拖累主窗口） | 单语言（JS） | 已实现 |
| 子进程 JSON-RPC | Onagre/pop-launcher, Kunkun (Deno) | OS 进程 | 中（fork） | 强 | 任意 | 需新增子进程管理层 |
| WASM 组件 (Zed / Extism) | Zed | wasmtime linear memory | 快 | 强 | 任意可编到 WASM 的语言 | 需新增 wasmtime 依赖 |
| 编译期插件（Loungy） | Loungy | 无 | 无 | 差 | 单语言 | 与市场化目标冲突 |

**结论**：iframe 模型对 UI 型插件已经够用；真正差的是 **"命令类无 UI 插件" 的运行环境**（当前只能装个 iframe 也要执行 headless JS，浪费）。这类插件恰是 Raycast 生态里占比最大的一类。

## 三、值得借鉴的具体做法

### 1. Capability 语法：Deno + Tauri 交叉

- **Deno 权限**：`--allow-net=api.github.com,api.openai.com --allow-fs=~/Documents/Notes` — 域名/路径级别的白名单，用户可读。
- **Tauri v2 capability**：`capabilities/*.json` 里描述 window+插件可用命令组，编译期检查。
- **Kunkun** 直接把 Deno 权限映射到 manifest，用户装插件时看到的是「允许访问 api.foo.com 和 ~/Downloads」而不是模糊的「网络+文件」。

**Qx 可以做**：把当前的 `permissions: ["network","clipboard.read", ...]` 扩展为结构化 grammar：

```json
{
  "permissions": {
    "network": ["api.openai.com", "*.notion.so"],
    "fs.read": ["~/Documents/Notes/**"],
    "fs.write": ["~/.qx/plugin-data/{id}/**"],
    "invoke": ["read_clipboard", "search_apps"]
  }
}
```

安装时 UI 一条一条列出来，用户能勾。iframe runtime 侧继续用现有 `assertPermission` 校验，只是判定输入从字符串变对象。

### 2. Preferences 强类型（Raycast / Ulauncher）

Raycast 的 `preferences` 是 `{ name, type: "textfield"|"password"|"checkbox"|"dropdown"|"appPicker"|"file", title, description, required, default }`。Ulauncher 是 `{ id, type: "input"|"checkbox"|"select", name, options }`。

**Qx 现状**：只有 `string / number / boolean / password / select`，缺 file/directory picker、appPicker、多值等。可以对齐 Raycast 的类型集，前端在 `PluginManager` 里按类型渲染对应 shadcn 控件（已在计划里）。

### 3. `schema_version`（Zed / Raycast Store）

Zed extension 里第一行就是 `schema_version = 1`。任何 breaking 改动就 +1，老插件仍走 v1 loader。我们 `qx-plugin.json` 目前没版本字段，一旦 manifest 演进就会互相污染。

**建议**：`"schema_version": 1` 立刻加进 manifest，之后所有 loader 用这个字段路由。

### 4. Dev plugins 目录（Raycast、Zed、Kunkun）

Zed 有 `~/.config/zed/extensions/installed/*/dev` 概念，Raycast 有 `Import Extension` 直连本地目录。他们统一的做法是：**一个目录被声明为 dev，Qx 就监听 manifest / `dist/index.js`，一改动直接卸载重装**。

我们已经有 `start_dev_watcher`。缺一层「dev-plugins/」根目录 UI，让用户添加多个 dev 目录，而不是一次装一个开发插件。用 `notify` crate（watchexec 底层）监听即可。

### 5. Signed marketplace mirror（Zed / Raycast Store）

Zed 的做法：extension registry 是一个 git 仓库，CI 打 `.tar.gz`，把 `sha256` 写到 `extensions.json`。客户端只从 CDN 取内容并校验 hash。相比我们现在的 ed25519 单文件签名，多了一层「registry-level 内容寻址」：

- 用户看得到「这个版本的 sha256 是 X」
- Registry PR 里 hash 变了就等于新版本，走 review

**Qx 借鉴**：`plugin-marketplace/index.json` 里给每个版本记录 `sha256`；客户端下载后本地校验，与 ed25519 双保险。

### 6. Fuzzy matcher：`nucleo`

Helix / Zed / 现代 Rust 命令面板都在用 [`nucleo`](https://github.com/helix-editor/nucleo)（helix-editor 团队维护，比 `fuzzy-matcher` 快数倍且支持多线程增量匹配）。Qx 目前打分逻辑手写在 `registry.ts` 的 `scoreCommand` 里，逐字符 O(n·m) 遍历。

**建议**：把命令 / 应用 / 剪贴板一起丢进 `nucleo::Matcher`，前端搜索 IPC 直接返回 `Vec<Match>`。可以先从 Rust 侧的 `search_apps` 开始替换，性能提升明显；命令层维持前端打分即可（数据集小）。

### 7. WASM component 作为第二后端

Zed 用 `wasmtime` + `wit-bindgen`，宿主暴露一组 host functions（如 `download-file`, `read-clipboard`），插件用 Rust / JS / Go 编成 `.wasm` 组件。

**对 Qx 的价值**：

- **无 UI 命令类插件**：加载一个 WASM 组件就能跑，不用起 iframe。
- **CPU 密集型工具**（图像转换、正则处理、Markdown 渲染）：WASM 性能碾压 JS。
- **多语言生态**：Rust/Go/AssemblyScript 都能写。

**取舍**：wasmtime 增加 ~5 MB 二进制、component model 生态不成熟；建议作为**可选后端**，与 iframe 并存，manifest 用 `runtime: "iframe" | "wasm"` 二选一。

或先用 **Extism**（多语言 SDK 完备，component model 转 Extism plugin 只是 wrapper），Qx 侧只需要 `extism` crate + 声明 host functions。

### 8. UI-less 命令与「View Command」分离（Raycast）

Raycast 区分：

- **No-view Command**：不弹 UI，只做副作用（发通知 / 复制到剪贴板 / 打开 URL）
- **View Command**：返回一个 React 树，Raycast 自渲染

Qx 现在所有插件都是「iframe 面板」，即使命令只想复制到剪贴板也得起 iframe。可以在 manifest 加：

```json
{
  "commands": [
    { "id": "copy-color", "mode": "no-view", "handler": "commands/copyColor.js" },
    { "id": "browse-issues", "mode": "view", "panel": "panels/issues.html" }
  ]
}
```

no-view 命令走 Web Worker（或 WASM），避免 iframe 开销、启动更快。

### 9. AI 扩展（Raycast AI Extensions）

Raycast 允许扩展声明 `tools`（JSON schema），LLM 侧决定何时调用；我们已经有 `context.ai.tasks.submit`，但方向反了：**Qx 现状是插件调 LLM，Raycast 是 LLM 调插件**。

**下一步**：允许插件在 manifest 声明 `ai.tools: [{name, description, parameters}]`，QxAI 在系统提示里注入所有已启用插件的 tool schema，模型选中的 tool 由 `plugin_ai_tool_call` 命令派发到对应插件的 iframe。这样才叫「AI-native launcher」。

## 四、推荐的 Rust 依赖

| 用途 | Crate | 说明 |
|---|---|---|
| Fuzzy matcher | [`nucleo`](https://crates.io/crates/nucleo) | Helix/Zed 在用，多线程、增量 |
| 文件监听（dev plugins） | [`notify`](https://crates.io/crates/notify) | 跨平台，Tauri 内部也在用 |
| WASM 组件运行时 | [`wasmtime`](https://crates.io/crates/wasmtime) + [`wit-bindgen`](https://crates.io/crates/wit-bindgen) | 官方 component model 链路 |
| WASM 简化封装 | [`extism`](https://crates.io/crates/extism) | 多语言 SDK 现成，快速验证用 |
| 内嵌 JS（备选） | [`rquickjs`](https://crates.io/crates/rquickjs) / [`boa_engine`](https://crates.io/crates/boa_engine) / [`deno_core`](https://crates.io/crates/deno_core) | QuickJS 最轻、Boa 纯 Rust、deno_core 最强但重 |
| 内嵌 Deno（Kunkun 方案） | [`deno_runtime`](https://crates.io/crates/deno_runtime) | 直接复用 Deno permission 模型 |
| 内容寻址（marketplace mirror） | [`sha2`](https://crates.io/crates/sha2) + `oci-distribution` | 后者是 OCI registry 客户端 |
| JSON schema 校验（AI tool） | [`jsonschema`](https://crates.io/crates/jsonschema) | 校验 LLM 输出符合 tool 参数 |

## 五、给 Qx 的落地建议（优先级）

1. **P0 · 立刻可做**
   - manifest 加 `schema_version`
   - permission 从字符串数组升级为对象 grammar；老格式向后兼容
   - dev plugins 目录 + `notify` 监听
   - marketplace index.json 每条加 `sha256`，客户端下载后校验

2. **P1 · 中期（1-2 版本）**
   - Rust 侧 `search_apps` / `search_commands` 换 `nucleo`
   - Preferences 类型对齐 Raycast（file/directory/appPicker）
   - `mode: "no-view"` 命令走 Web Worker，跳过 iframe

3. **P2 · 长期**
   - 引入 wasmtime 作为第二运行时（先 Extism 快速验证）；manifest `runtime` 字段
   - AI Extensions（插件声明 tools，让 QxAI 在会话中调用插件）
   - 命令/AI tool 结果统一走结构化 payload，前端由 Qx 渲染，脱离 iframe（对齐 Raycast View Command）

## 六、参考

- Zed extensions: <https://zed.dev/docs/extensions>
- Zed 扩展仓库: <https://github.com/zed-industries/extensions>
- Extism: <https://extism.org>
- wasmtime component model: <https://component-model.bytecodealliance.org>
- Vicinae: <https://github.com/vicinaehq/vicinae>
- Onagre / pop-launcher: <https://github.com/onagre-launcher/onagre> · <https://github.com/pop-os/launcher>
- Kunkun: <https://github.com/kunkunsh/kunkun>
- Loungy: <https://github.com/MatthiasGrandl/Loungy>
- Asyar: <https://github.com/anfragment/asyar>
- Ulauncher plugin API: <https://docs.ulauncher.io>
- Raycast API: <https://developers.raycast.com>
- nucleo: <https://github.com/helix-editor/nucleo>
- notify: <https://github.com/notify-rs/notify>
