---
name: Qx Plugin Capabilities
description: Discover and run installed Qx marketplace plugins as agent capabilities. Use when the user wants plugin tools or extensions beyond built-in modules.
mode: smart
capabilities:
  - tool:list_qx_capabilities
  - tool:run_qx_capability
  - tool:list_plugins
  - tool:run_plugin_command
  - tool:list_module_actions
  - tool:run_module_action
---

# Qx Plugin Capabilities

Qx plugins are a **first-class extension surface** for the agent—not only UI packages.

## Discovery

1. `list_plugins` — installed plugins + launcher commands (enabled flag).
2. `list_qx_capabilities` with `kind: "plugin_command"` — runnable `command:<pluginId>:<name>` ids.
3. `list_module_actions` / `list_qx_capabilities` with `kind: "module_action"` — includes `plugin:<pluginId>:<action>` when plugins call `context.ai.actions.register`.

## Execution

| Need | Call |
|------|------|
| Launcher command | `run_plugin_command` `{ pluginId, command }` or `run_qx_capability` `{ id: "command:pluginId:name" }` |
| Registered AI action | `run_module_action` / `run_qx_capability` with `plugin:<id>:<action>` |
| Fine-grained host tool | call the tool by name from `list_qx_capabilities` (`tool:…`) |

## Authoring plugins for the agent

Plugins that want to expose AI-callable work should:

1. Declare permission `ai-tools`.
2. On panel/command start: `context.ai.actions.register([{ id, title, description, risk, command?, invokeCommand? }])`.
3. Optionally ship a skill under `~/.qx/skills` with frontmatter:

```yaml
capabilities:
  - plugin:my-plugin:sync
  - command:my-plugin:open
```

4. Unregister on unload (host also clears on disable).

## Rules

- Never claim a plugin ran if the command failed or the plugin is disabled.
- Prefer capability ids from live `list_*` results over memorized names.
- Visible UI side effects only when they fulfill the user request.
