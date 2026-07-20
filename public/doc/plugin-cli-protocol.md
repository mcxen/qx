# Plugin CLI 接口协议（`context.cli`）

> 作者总手册：[`plugin-development-guide.md`](./plugin-development-guide.md)
> 本文是 **`context.cli` 端口** 的完整契约（请求/响应/安全/版本）。

稳定端口：插件跑本机命令行工具（Homebrew、发布 CLI、内部工具等）。
**默认 argv 模式**；需要管道 / 通配符 / 复杂 shell 时用 **`context.cli.bash`**。
**不依赖** Settings → AI Agent 的 Bash 开关（与 `context.ai.runBash` 不同）。

---

## 1. 权限

| 权限 | 作用 |
|------|------|
| `cli` | 允许 `context.cli.*`（run / bash / which / 异步 jobs / map） |
| `system` | 允许 `context.system.env` / `openPath` / `revealPath` / `openSettings` / `setWallpaper` |
| `invoke:plugin_cli_*` 等 | 若走 `context.invoke(...)` 时的精确授权（危险命令集） |

manifest 示例（CLI 工具 + 打开产物）：

```json
"permissions": ["cli", "system", "notifications", "open-url"]
```

---

## 2. 请求 / 响应

### `context.cli.run(request)` — argv（推荐默认）

```ts
type PluginCliRunRequest = {
  /** 绝对路径，或 PATH 上的命令名（见 §3 PATH 解析） */
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 默认 60000，限制 1000–600000 */
  timeoutMs?: number;
};

type PluginCliRunResult = {
  status: number | null;   // 超时为 null
  stdout: string;
  stderr: string;
  timedOut: boolean;
  program: string;         // 实际 spawn 的路径
};
```

### `context.cli.bash(script | request)` — 完整 login bash

需要管道、重定向、`&&`、glob、shell 函数时使用。宿主执行：

```text
bash -lc "<script>"
```

并注入与 `run` 相同的 **login-shell PATH**。

```ts
type PluginCliBashRequest = {
  script: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

// 两种调用形式：
await context.cli.bash("brew list --formula | head -20");
await context.cli.bash({
  script: "cd \"$HOME/proj\" && make release",
  cwd: "/tmp",
  timeoutMs: 120_000,
});
// 返回值形状与 PluginCliRunResult 相同；program 为 "…/bash -lc"
```

> **不要**把不受信的用户原文直接拼进 `script`。参数化输入优先 `cli.run({ program, args })`。

### `context.cli.which(program)`

```ts
Promise<string | null>  // 解析到的绝对路径，找不到为 null
```

### 异步任务（`start` / `poll` / `cancel` / `wait` / `listJobs`）

长命令、需要**取消**或**边跑边刷 UI** 时用 job API。每个 job 在**独立 OS 线程**里跑子进程，stdout/stderr **边读边入快照**（每流上限 512 KiB，超出后继续排空管道但不再保留，并附加截断标记）。默认 `wait` 每 500ms 轮询，避免大日志快照造成无意义的 IPC 压力。

```ts
type PluginCliStartRequest =
  | ({ kind: "run" } & PluginCliRunRequest)
  | ({ kind: "bash" } & PluginCliBashRequest);

type PluginCliJobState =
  | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timedOut";

type PluginCliJobSnapshot = {
  id: string;
  pluginId: string;
  kind: string;
  state: PluginCliJobState;
  program: string;
  stdout: string;   // 运行中也会增长
  stderr: string;
  status: number | null;
  timedOut: boolean;
  startedAt: number;
  finishedAt: number | null;
  error?: string | null;
  running: boolean;
};

// 立即返回 job，不阻塞 iframe
const job = await context.cli.start({
  kind: "run",
  program: "ffmpeg",
  args: ["-i", inPath, outPath],
  timeoutMs: 300_000,
});

// 轮询 / 等待（onUpdate 可刷新日志面板）
const done = await context.cli.wait(job.id, {
  pollMs: 500,
  onUpdate: (snap) => {
    logEl.textContent = snap.stderr || snap.stdout;
  },
});
if (done.state === "cancelled") { /* … */ }
await context.cli.cancel(job.id); // 任意时刻可杀进程

// 本插件最近任务
const jobs = await context.cli.listJobs();
```

**并发上限**（宿主强制）：

| 范围 | 上限 |
|------|------|
| 单插件同时 `running` | 6 |
| 全局 job 表 | 32 |
| 已完成 job 保留 | ~10 分钟 |

超出上限时 `start` 抛错；请 `cancel` 或等完成后再开。

### 有界并行 `cli.map`（多任务）

对**短命令**做 fan-out（底层仍是 `run`，不是 job 表）：

```ts
const versions = await context.cli.map(
  ["git", "node", "python3"],
  async (bin) => {
    const r = await context.cli.run({ program: bin, args: ["--version"], timeoutMs: 10_000 });
    return { bin, out: r.stdout.trim() };
  },
  { concurrency: 3 },
);
```

也可直接 `Promise.all([cli.run(...), cli.run(...)])` — 每次 `run`/`bash` 都在 `spawn_blocking` 线程池里执行，互不堵死 UI 线程。

### 系统能力 `context.system`（权限 `system`）

```ts
const env = await context.system.env();
// {
//   platform, arch, homeDir, tempDir,
//   dirSep,       // "\\" on Windows, "/" elsewhere
//   pathListSep,  // ";" on Windows, ":" elsewhere
//   pathSep,      // compatibility alias for pathListSep
//   exePath?
// }

await context.system.openPath("~/Downloads/out.mp4");  // 系统默认打开
await context.system.revealPath(outPath);              // Finder / Explorer 选中
await context.system.setWallpaper(outPath, { scope: "every" }); // macOS / Windows
await context.system.openSettings("storage");          // 系统设置的语义分区
```

| 方法 | 说明 |
|------|------|
| `env()` | 平台、架构、home/temp、目录分隔符与 PATH 列表分隔符 |
| `openPath(path)` | 用系统默认应用打开（支持 `~/`） |
| `revealPath(path)` | 在文件管理器中显示 |
| `setWallpaper(path, { scope? })` | 用宿主平台适配器设置本地图片（支持插件虚拟路径）；`scope` 为 `current` / `every`，Windows 忽略桌面范围 |
| `openSettings(section)` | 打开 `about` / `display` / `storage` / `network` / `power` / `privacy` / `apps` 对应的 macOS 或 Windows 系统设置 |

Windows 的 `openPath` 由宿主直接调用 Shell API，路径不会经过 `cmd /C start` 解释；
空格、非 ASCII 与 shell 特殊字符保持原样。PowerShell、Explorer 和 taskkill 等
Windows inbox 程序统一从 `SystemRoot` 的宿主适配器解析，插件不得猜
`C:\Windows`，也不依赖 GUI 进程 PATH。

Windows 的 Bash 能力要求 Git for Windows 或 PATH 中可解析的 Bash，缺失时返回明确的
unavailable error，不回退 Unix 路径。可运行
`winget install --id Git.Git -e`，或从
[Git for Windows](https://gitforwindows.org/) 安装，随后重启 Qx 让 GUI PATH 生效。
不需要 POSIX 管道/语法时优先改用 `context.cli.run({ program, args })`。
拼接展示路径时使用 `dirSep`；拆分 `PATH` 等列表变量时使用 `pathListSep`。旧字段
`pathSep` 保留兼容，但其语义是 PATH 列表分隔符，不是目录分隔符。

与 `openUrl`（`open-url` 权限）不同：`system` 面向**本地路径**与环境信息。

### CLI→GUI 助手（宿主注入，无额外 RPC）

在 iframe / 直接 context 上由宿主叠加（实现见 `src/plugin/cliWorkbench.ts`）：

| 方法 | 说明 |
|------|------|
| `cli.ensure(req)` | `run` + 非 0/超时 throw |
| `cli.json(req)` | `ensure` + 解析 stdout JSON（`jsonl: true` 为 JSONL） |
| `cli.lines(req)` | `ensure` + 按行切分 |
| `cli.text(req)` | `ensure` + 文本 |
| `cli.jsonBash(script)` | `bash` + JSON |
| `cli.parseJson` / `parseJsonLines` | 纯解析 |
| `cli.wait` / `cli.map` | 异步等待与有界并行 |
| `ui.mountWorkbench` / `itemsFromJson` | 声明式 List/Gallery 工作台；受控 query/tab/selection，action 携带触发时选择快照 |

完整产品化指南：[`plugin-cli-gui.md`](./plugin-cli-gui.md)。

### 后端命令

| Tauri command | RPC method |
|---------------|------------|
| `plugin_cli_run` | `cliRun` |
| `plugin_cli_bash` | `cliBash` |
| `plugin_cli_which` | `cliWhich` |
| `plugin_cli_start` | `cliStart` |
| `plugin_cli_poll` | `cliPoll` |
| `plugin_cli_cancel` | `cliCancel` |
| `plugin_cli_list_jobs` | `cliListJobs` |
| `plugin_system_env` | `systemEnv` |
| `plugin_system_open_path` | `systemOpenPath` |
| `plugin_system_reveal_path` | `systemRevealPath` |
| `plugin_system_set_wallpaper` | `systemSetWallpaper` |
| `plugin_system_open_settings` | `systemOpenSettings` |

请求/响应字段使用 **camelCase** JSON；Tauri invoke 参数名与 Rust 一致（如 `plugin_id`、`job_id`）。

---

## 3. PATH 解析（解决「找不到命令」）

GUI 启动的 Qx **没有** Terminal 的完整 PATH。宿主对 `run` / `which` / `bash` 子进程统一做：

1. **已知目录**：Homebrew（`/opt/homebrew/bin`、`/usr/local/bin`）、系统 bin、`~/.local/bin`、`~/.cargo/bin` 等
2. **登录 shell PATH**：`"$SHELL" -lc 'printf %s "$PATH"'`（缓存；失败则跳过）
3. **进程 PATH**：Qx 自身环境
4. 子进程默认注入合并后的 `PATH`（插件 `env.PATH` 可覆盖）
5. `~/…` 绝对路径会展开 `HOME` / `USERPROFILE`
6. Windows 额外尝试 `.exe` / `.cmd` / `.bat`，并以显式 UTF-8 读取、合并
   Machine+User Path，中文用户名与安装目录不会经过当前控制台代码页损坏

因此：

```js
await context.cli.which("brew");   // GUI 下也应能解析到 brew
await context.cli.run({ program: "git", args: ["--version"] });
```

仍失败时：在 preferences 填**绝对路径**。Windows 若明确需要 Bash，请安装 Git for
Windows 并重启 Qx；否则使用 argv 形式的 `cli.run`。macOS/Linux 可用 `cli.bash`
让 login 脚本读取 profile。

---

## 4. 语义与安全

| 规则 | 说明 |
|------|------|
| argv 默认 | `run` 不经过 shell；参数按 argv 传递 |
| bash 显式 | 仅 `bash` API 走 login Bash（Windows 需 Git for Windows） |
| 禁止空 program / 空 script | 空串 / NUL 拒绝 |
| 裸名安全字符 | 非路径名禁止 `|&;$` 等元字符（`bash` 的 script 除外） |
| 超时 | 超时 kill 子进程，返回 `timedOut: true`、`status: null` |
| 工作目录 | 可选 `cwd`；不传则继承宿主进程 cwd |
| 环境变量 | `env` 合并进子进程；禁止空 key；默认 PATH 已增强 |

与 `context.ai.runBash` 的区别：

| | `context.cli.bash` | `context.ai.runBash` |
|--|--------------------|----------------------|
| 权限 | `cli` | `ai-bash` + Agent 工具开关 |
| Settings 门控 | **无** | 需开启 Agent Bash |
| 用途 | 业务插件本机工具 | AI Agent 工具链 |

---

## 5. 最小可用示例

```js
export default {
  commands: [
    {
      name: "brew-list",
      title: "List Brew Formulae",
      async run(context) {
        // argv（优先）
        const brew = (await context.cli.which("brew")) || "brew";
        const result = await context.cli.run({
          program: brew,
          args: ["list", "--formula"],
          timeoutMs: 60_000,
        });
        // 或 shell 管道：
        // const result = await context.cli.bash("brew list --formula | wc -l");
        if (result.timedOut) {
          context.showToast("brew list timed out");
          return;
        }
        if (result.status !== 0) {
          context.showToast(result.stderr || `brew exit ${result.status}`);
          return;
        }
        const lines = result.stdout.trim().split("\n").filter(Boolean);
        context.showToast(`${lines.length} formulae`);
      },
    },
  ],
};
```

---

## 6. 与宿主版本

| 能力 | `min_app_version` 建议 |
|------|------------------------|
| `context.cli.run` / `which` | `0.5.26` |
| login PATH 增强 + `context.cli.bash` | `0.5.26+` |
| `cli.start` / `poll` / `cancel` / `wait` / `map` + `context.system` | 合入本协议的版本起 |
| `context.system.openSettings` + 跨平台 typed Sysinfo 模型 | `0.6.0+` |

---

## 7. 测试清单

- [ ] GUI 启动（非终端）下 `which("brew")` / `run({ program: "brew", args: ["--version"] })` 成功
- [ ] `cli.bash("echo $PATH")` 含 `/opt/homebrew/bin` 或用户 profile 路径
- [ ] 无 `cli` 权限时明确报错
- [ ] 不存在的 program → `which` 为 null；`run` throw
- [ ] 超时：短 `timeoutMs` + 慢命令 → `timedOut === true`
- [ ] 插件 `env: { PATH: "..." }` 可覆盖宿主注入
- [ ] `cli.start` + `wait` 期间 `onUpdate` 能看到 stdout 增长；`cancel` 后 `state === "cancelled"`
- [ ] `cli.map` concurrency=2 跑 4 个短命令全部完成
- [ ] 无 `system` 时 `openPath` 报权限错误；有权限时能打开目录
- [ ] `openSettings("storage")` 在 macOS / Windows 打开对应系统设置；未知 section 明确失败
- [ ] Windows 缺 Git Bash 时错误包含 winget、官方下载地址与“重启 Qx”提示
- [ ] 超过 6 个并发 job 时 `start` 失败信息清晰

---

## 8. 相关文档

- [`plugin-development-guide.md`](./plugin-development-guide.md)
- [`plugin-cli-gui.md`](./plugin-cli-gui.md)
- [`plugin-system.md`](./plugin-system.md)
- [`docs/plugin-architecture.md`](../../docs/plugin-architecture.md)
