---
name: Morning Desk Log
description: Daily 10:00 desktop screenshot + clipboard digest saved as Markdown under Downloads/QxLogs. Use module tools and QxAI schedules.
mode: fixed
capabilities:
  - tool:qx_screenshot
  - tool:qx_clipboard_history
  - tool:list_schedules
  - tool:upsert_schedule
  - tool:run_schedule_now
  - tool:qx_logs_directory
---

# Morning Desk Log

You help Qx keep a durable morning journal using **host module ports** (not simulated success).

## Module tools (call these)

| Tool | Module | Purpose |
|------|--------|---------|
| `qx_screenshot` | Screencap | Capture full desktop (primary display). Optional `destDir` under Downloads/QxLogs/screenshots. |
| `qx_clipboard_history` | Clipboard | Read recent clipboard items (text, OCR, paths). |
| `list_schedules` / `upsert_schedule` / `delete_schedule` / `run_schedule_now` | QxAI Schedule | Configure or trigger timed jobs. |
| `qx_logs_directory` | Files | Resolve `~/Downloads/QxLogs`. |

Frontmatter `capabilities:` binds these tools so the host can inject a live availability check each turn.

## Recommended daily schedule

- **Kind:** `morning_desk_log` (headless pipeline — works even when chat UI is closed)
- **Time:** `10:00` local
- **Effect:**
  1. Capture primary display → `Downloads/QxLogs/screenshots/`
  2. Read this morning's clipboard history
  3. Ask the default Agent model to write a Markdown journal
  4. Save → `Downloads/QxLogs/YYYY-MM-DD-morning.md`

Enable the pre-seeded schedule **Morning desk log** under Settings → AI Agent → Schedules, or create one:

```json
{
  "id": "morning-desk-log-10",
  "name": "Morning desk log",
  "enabled": true,
  "kind": "morning_desk_log",
  "dailyTime": "10:00",
  "skillId": "morning-desk-log",
  "prompt": "Summarize this morning's desktop and clipboard."
}
```

For a full tool-using agent turn at a clock time, use kind `agent_prompt` with a free-form `prompt` and optional `skillId`.

## Manual run (chat)

When the user asks to run the morning log now:

1. `qx_screenshot` with `destDir` pointing at the screenshots folder under `qx_logs_directory`.
2. `qx_clipboard_history` with `limit` 40–80.
3. Write a clear Markdown journal covering: desktop snapshot path, clipboard highlights, action items.
4. Save with bash or by instructing the schedule `run_schedule_now` for `morning-desk-log-10`.

Prefer `run_schedule_now` when the user wants the exact headless pipeline.

## Rules

- Never invent clipboard rows or screenshot paths.
- Prefer Chinese when the user's clips are Chinese; otherwise English.
- Visible side effects (open/reveal) only when the user asks.
