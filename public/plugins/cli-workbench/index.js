/**
 * CLI Workbench — reference plugin for CLI → GUI.
 *
 * Host ports used:
 *   context.cli.json / lines / text / jsonBash / ensure / which
 *   context.ui.mountWorkbench / itemsFromJson
 *
 * Panel render returns immediately (loading UI), then reloads data async.
 */

const TABS = [
  { id: "json", label: "JSON demo" },
  { id: "jsonl", label: "JSONL" },
  { id: "lines", label: "Lines" },
  { id: "system", label: "System" },
  { id: "custom", label: "Custom" },
];

function splitArgs(text) {
  return String(text || "")
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    ?.map((part) => part.replace(/^"|"$/g, "")) || [];
}

async function loadDataset(context, tab) {
  if (tab === "json") {
    // Pure demo payload — no external tool required.
    const data = await context.cli.jsonBash(`
      python3 - <<'PY'
import json
print(json.dumps([
  {"id":"alpha","name":"Alpha Service","desc":"Healthy","kind":"svc","version":"1.2.0"},
  {"id":"beta","name":"Beta Worker","desc":"Degraded","kind":"worker","version":"0.9.1","badge":"warn"},
  {"id":"gamma","name":"Gamma DB","desc":"Primary","kind":"db","version":"15.3"}
], indent=2))
PY
    `).catch(async () => {
      // Fallback if python3 is missing: bash printf JSON
      return context.cli.jsonBash(
        `printf '%s' '[{"id":"alpha","name":"Alpha Service","desc":"Healthy","kind":"svc","version":"1.2.0"},{"id":"beta","name":"Beta Worker","desc":"Degraded","kind":"worker","version":"0.9.1","badge":"warn"},{"id":"gamma","name":"Gamma DB","desc":"Primary","kind":"db","version":"15.3"}]'`,
      );
    });
    return {
      meta: "context.cli.jsonBash → array of objects → list + JSON detail",
      data,
      items: context.ui.itemsFromJson(data),
    };
  }

  if (tab === "jsonl") {
    const rows = await context.cli.jsonBash(
      `printf '%s\\n' '{"name":"job-1","status":"ok"}' '{"name":"job-2","status":"fail"}' '{"name":"job-3","status":"ok"}'`,
      { jsonl: true },
    );
    return {
      meta: "JSON Lines (one object per line) via jsonBash({ jsonl: true })",
      data: rows,
      items: context.ui.itemsFromJson(rows),
    };
  }

  if (tab === "lines") {
    const lines = await context.cli.lines({
      program: "bash",
      args: ["-lc", "printf '%s\\n' 'README.md' 'package.json' 'src/main.ts' 'public/plugins/cli-workbench'"],
      timeoutMs: 10_000,
    }).catch(async () =>
      context.cli.lines({
        program: "printf",
        args: ["%s\\n", "README.md", "package.json", "src/main.ts"],
      }),
    );
    const items = lines.map((line, index) => ({
      id: String(index),
      title: line,
      subtitle: "text line",
      badge: "line",
      raw: line,
    }));
    return {
      meta: "context.cli.lines — plain stdout split into rows",
      data: lines,
      items,
    };
  }

  if (tab === "system") {
    const uname = await context.cli.text({
      program: (await context.cli.which("uname")) || "uname",
      args: ["-a"],
      timeoutMs: 10_000,
    }).catch(() => "uname unavailable");
    const entries = {
      uname,
      platform: String(context.pluginId ? "plugin" : "host"),
      pathSample: (await context.cli.which("bash")) || "(bash not found)",
      brew: (await context.cli.which("brew")) || "(brew not found)",
      node: (await context.cli.which("node")) || "(node not found)",
    };
    return {
      meta: "context.cli.which + text — path resolution under GUI PATH",
      data: entries,
      items: context.ui.itemsFromJson(entries),
    };
  }

  // custom
  const programPref = String((await context.getPreference("customProgram")) || "uname").trim();
  const argsPref = String((await context.getPreference("customArgs")) || "-a");
  const program = (await context.cli.which(programPref)) || programPref;
  const args = splitArgs(argsPref);
  const result = await context.cli.ensure({
    program,
    args,
    timeoutMs: 30_000,
  });
  const stdout = String(result.stdout || "").trim();
  let data;
  let items;
  try {
    data = context.cli.parseJson(stdout);
    items = context.ui.itemsFromJson(data);
  } catch {
    data = stdout;
    items = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => ({
        id: String(index),
        title: line,
        badge: "out",
        raw: line,
      }));
  }
  return {
    meta: `custom: ${program} ${args.join(" ")} → auto JSON or lines`,
    data,
    items,
  };
}

function createState() {
  return {
    dead: false,
    tab: "json",
    query: "",
    loading: false,
    error: null,
    meta: "",
    items: [],
    data: null,
    selectedId: null,
    reloadGeneration: 0,
  };
}

function filteredItems(state) {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((item) =>
    [item.title, item.subtitle, item.meta, item.badge]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(q)),
  );
}

function detailFor(item) {
  if (!item) return undefined;
  if (item.raw && typeof item.raw === "object" && !Array.isArray(item.raw)) {
    return {
      title: item.title,
      subtitle: item.subtitle,
      fields: Object.entries(item.raw).map(([label, value]) => ({
        label,
        value: value != null && typeof value === "object" ? JSON.stringify(value) : value,
      })),
      body: JSON.stringify(item.raw, null, 2),
    };
  }
  return {
    title: item.title,
    subtitle: item.subtitle,
    body: JSON.stringify(item.raw !== undefined ? item.raw : item, null, 2),
  };
}

function paint(context, state) {
  if (state.dead) return;
  const items = filteredItems(state);
  const selected =
    items.find((item) => String(item.id) === String(state.selectedId)) ||
    items[0] ||
    null;
  if (selected) state.selectedId = String(selected.id ?? selected.title);

  context.ui.mountWorkbench(
    {
      title: "CLI Workbench",
      meta: state.meta || "Turn CLI stdout into list + detail",
      error: state.error,
      loading: state.loading,
      query: state.query,
      queryPlaceholder: "Filter items…",
      tabs: TABS.map((tab) => ({ ...tab, active: tab.id === state.tab })),
      actions: [
        { id: "reload", label: state.loading ? "Loading…" : "Reload", primary: true, disabled: state.loading },
        { id: "copy", label: "Copy JSON", disabled: !selected && state.data == null },
      ],
      items: items.map((item) => ({ ...item, detail: detailFor(item) })),
      selectedId: state.selectedId,
      emptyText: state.loading ? "Running CLI…" : "No rows — try another tab or Reload",
    },
    {
      onTab: (id) => {
        state.tab = id;
        state.selectedId = null;
        void reload(context, state);
      },
      onAction: (id) => {
        if (id === "reload") void reload(context, state);
        if (id === "copy") {
          const payload = selected?.raw ?? state.data;
          void context.clipboard.write(JSON.stringify(payload, null, 2)).then(() => {
            context.showToast("Copied JSON to clipboard");
          }).catch((err) => context.showToast(String(err?.message || err)));
        }
      },
      onQuery: (value) => {
        state.query = value;
        paint(context, state);
      },
      onSelect: (id) => {
        state.selectedId = id;
        paint(context, state);
      },
    },
  );
}

async function reload(context, state) {
  if (state.dead) return;
  const generation = ++state.reloadGeneration;
  state.loading = true;
  state.error = null;
  paint(context, state);
  try {
    const result = await loadDataset(context, state.tab);
    if (state.dead || generation !== state.reloadGeneration) return;
    state.meta = result.meta;
    state.data = result.data;
    state.items = result.items;
    if (!state.selectedId && state.items[0]) {
      state.selectedId = String(state.items[0].id ?? state.items[0].title);
    }
  } catch (error) {
    if (state.dead || generation !== state.reloadGeneration) return;
    state.error = String(error?.message || error);
    state.items = [];
    state.data = null;
  } finally {
    if (!state.dead && generation === state.reloadGeneration) {
      state.loading = false;
      paint(context, state);
    }
  }
}

export default {
  commands: [
    {
      name: "open-workbench",
      title: "CLI Workbench",
      async run(context) {
        // Panel is the main surface; toast guides users.
        context.showToast("Open CLI Workbench from the sidebar / search “CLI Workbench”.");
      },
    },
    {
      name: "demo-json-toast",
      title: "Demo: CLI JSON toast",
      async run(context) {
        try {
          const data = await context.cli.jsonBash(
            `printf '%s' '{"ok":true,"count":3,"items":["a","b","c"]}'`,
          );
          const count = Array.isArray(data.items) ? data.items.length : data.count;
          context.showToast(`JSON ok — count ${count}`);
        } catch (error) {
          context.showToast(String(error?.message || error));
        }
      },
    },
  ],

  panel: {
    render(container, context) {
      const state = createState();
      container.__qxCliWorkbench = state;
      // Critical: paint loading shell and return immediately (renderPanel timeout).
      paint(context, state);
      void reload(context, state);
    },
    destroy(container) {
      if (container.__qxCliWorkbench) {
        container.__qxCliWorkbench.dead = true;
      }
      container.innerHTML = "";
    },
  },
};
