# Plugin CLI 接口协议（`context.cli`）

稳定端口：插件跑本机命令行工具（Homebrew、发布 CLI、内部工具等）。  
**默认 argv 模式（无 shell）**，不依赖 Settings → AI Agent 的 Bash 开关。

> 与 `context.ai.runBash` 的区别：`ai-bash` 走 bash 脚本且受 Agent 门控；业务插件优先用 **`cli`**。

---

## 1. 权限

| 权限 | 作用 |
|------|------|
| `cli` | 允许 `context.cli.run` / `context.cli.which` |
| `invoke:plugin_cli_run` | 若走 `context.qx.invokeRust("plugin_cli_run")` 时的精确授权（危险命令集） |

manifest 示例：

```json
"permissions": ["cli", "notifications", "open-url"]
```

---

## 2. 请求 / 响应

### `context.cli.run(request)`

```ts
type PluginCliRunRequest = {
  /** 绝对路径，或 PATH 上的命令名（macOS 会优先查 /opt/homebrew/bin、/usr/local/bin） */
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

### `context.cli.which(program)`

```ts
Promise<string | null>  // 解析到的绝对路径，找不到为 null
```

### 后端命令

| Tauri command | RPC method |
|---------------|------------|
| `plugin_cli_run` | `cliRun` |
| `plugin_cli_which` | `cliWhich` |

字段使用 **camelCase** JSON。

---

## 3. 语义与安全

| 规则 | 说明 |
|------|------|
| 无 shell | 不经过 `/bin/sh -c`；参数按 argv 传递，避免注入 |
| 禁止空 program | 空串 / NUL 拒绝 |
| 裸名安全字符 | 非路径名禁止 `|&;$` 等元字符 |
| 超时 | 超时 kill 子进程，返回 `timedOut: true`、`status: null` |
| 工作目录 | 可选 `cwd`；不传则继承宿主进程 cwd |
| 环境变量 | `env` 合并进子进程；禁止空 key |

**不要**用此 API 执行不受信用户原文拼接的命令行；始终 `program` + `args[]`。

---

## 4. 最小可用示例

```js
export default {
  commands: [
    {
      name: "brew-list",
      title: "List Brew Formulae",
      async run(context) {
        const brew = (await context.cli.which("brew")) || "brew";
        const result = await context.cli.run({
          program: brew,
          args: ["list", "--formula"],
          timeoutMs: 60_000,
        });
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

发布 / 重发业务：

```js
const cli = String(await context.getPreference("cliPath") || "release-cli");
const out = await context.cli.run({
  program: cli,
  args: ["status", "--json", "--limit", "20"],
  cwd: String(await context.getPreference("workdir") || "") || undefined,
  timeoutMs: 60_000,
});
const items = JSON.parse(out.stdout);
```

---

## 5. 与宿主版本

| 能力 | `min_app_version` 建议 |
|------|------------------------|
| `context.cli` | `0.5.26`（以合并本协议的版本为准） |

未实现 `cli` 的旧宿主会 RPC 失败；插件应 `min_app_version` 钉住，并在 catch 里 toast 明确错误。

---

## 6. 测试清单（必须能跑通）

- [ ] 有 `cli` 权限的插件可 `which("brew")` / `run({ program: "brew", args: ["--version"] })`
- [ ] 无 `cli` 权限时明确报错，不静默
- [ ] 不存在的 program → `which` 为 null；`run` throw 或明确失败
- [ ] 超时：短 `timeoutMs` + 慢命令 → `timedOut === true`
- [ ] GUI 启动的 Qx 也能找到 `/opt/homebrew/bin/brew`（不依赖终端 PATH）

---

## 7. 相关文档

- 业务上手：[`plugin-development-guide.md`](./plugin-development-guide.md)
- 权限总表：[`plugin-system.md`](./plugin-system.md)
- 内部 runtime：[`docs/plugin-architecture.md`](../docs/plugin-architecture.md)
