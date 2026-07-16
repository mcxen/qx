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
| `cli` | 允许 `context.cli.run` / `context.cli.bash` / `context.cli.which` |
| `invoke:plugin_cli_run` 等 | 若走 `context.qx.invokeRust(...)` 时的精确授权（危险命令集） |

manifest 示例：

```json
"permissions": ["cli", "notifications", "open-url"]
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
| `ui.mountWorkbench` / `itemsFromJson` / `renderJson` | 列表工作台 |

完整产品化指南：[`plugin-cli-gui.md`](./plugin-cli-gui.md)。

### 后端命令

| Tauri command | RPC method |
|---------------|------------|
| `plugin_cli_run` | `cliRun` |
| `plugin_cli_bash` | `cliBash` |
| `plugin_cli_which` | `cliWhich` |

字段使用 **camelCase** JSON。

---

## 3. PATH 解析（解决「找不到命令」）

GUI 启动的 Qx **没有** Terminal 的完整 PATH。宿主对 `run` / `which` / `bash` 子进程统一做：

1. **已知目录**：Homebrew（`/opt/homebrew/bin`、`/usr/local/bin`）、系统 bin、`~/.local/bin`、`~/.cargo/bin` 等
2. **登录 shell PATH**：`"$SHELL" -lc 'printf %s "$PATH"'`（缓存；失败则跳过）
3. **进程 PATH**：Qx 自身环境
4. 子进程默认注入合并后的 `PATH`（插件 `env.PATH` 可覆盖）
5. `~/…` 绝对路径会展开 `HOME` / `USERPROFILE`
6. Windows 额外尝试 `.exe` / `.cmd` / `.bat`，并合并 Machine+User Path

因此：

```js
await context.cli.which("brew");   // GUI 下也应能解析到 brew
await context.cli.run({ program: "git", args: ["--version"] });
```

仍失败时：在 preferences 填**绝对路径**，或改用 `cli.bash`（login 脚本可 `source` profile）。

---

## 4. 语义与安全

| 规则 | 说明 |
|------|------|
| argv 默认 | `run` 不经过 shell；参数按 argv 传递 |
| bash 显式 | 仅 `bash` API 走 `/bin/bash -lc`（Windows 需 Git Bash 等） |
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
| login PATH 增强 + `context.cli.bash` | 合入本协议的版本起 |

---

## 7. 测试清单

- [ ] GUI 启动（非终端）下 `which("brew")` / `run({ program: "brew", args: ["--version"] })` 成功
- [ ] `cli.bash("echo $PATH")` 含 `/opt/homebrew/bin` 或用户 profile 路径
- [ ] 无 `cli` 权限时明确报错
- [ ] 不存在的 program → `which` 为 null；`run` throw
- [ ] 超时：短 `timeoutMs` + 慢命令 → `timedOut === true`
- [ ] 插件 `env: { PATH: "..." }` 可覆盖宿主注入

---

## 8. 相关文档

- [`plugin-development-guide.md`](./plugin-development-guide.md)
- [`plugin-system.md`](./plugin-system.md)
