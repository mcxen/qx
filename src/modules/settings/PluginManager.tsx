import { useEffect, useState } from "react";
import { useSettingsStore, type PluginConfig } from "./store";

interface LocalPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
}

const DEFAULT_LOCAL: LocalPlugin[] = [
  {
    id: "rss",
    name: "RSS Reader",
    version: "0.1.0",
    description: "Subscribe to feeds and read articles in a three-pane layout.",
    path: "~/.qx/plugins/rss",
  },
  {
    id: "clipboard",
    name: "Clipboard Manager",
    version: "0.1.0",
    description: "Track and search clipboard history (text, images, files).",
    path: "~/.qx/plugins/clipboard",
  },
  {
    id: "screenshot",
    name: "Screenshot + OCR",
    version: "0.1.0",
    description: "Region capture with overlay and searchable history.",
    path: "~/.qx/plugins/screenshot",
  },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: value ? "var(--color-accent)" : "var(--color-surface-active)",
        position: "relative",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
        }}
      />
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
        padding: "1px 6px",
        background: "var(--color-surface)",
      }}
    >
      {children}
    </span>
  );
}

export default function PluginManager() {
  const { settings, patch } = useSettingsStore();
  const [plugins, setPlugins] = useState<LocalPlugin[]>(DEFAULT_LOCAL);
  const [installPath, setInstallPath] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_LOCAL[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const map = new Map(settings.plugins.map((p) => [p.id, p]));
    setPlugins(
      DEFAULT_LOCAL.map((p) => {
        const stored = map.get(p.id);
        return stored
          ? { ...p, name: stored.name || p.name, version: stored.version || p.version }
          : p;
      }),
    );
  }, [settings.plugins]);

  const enabledMap = new Map(settings.plugins.map((p) => [p.id, p.enabled]));

  const isEnabled = (id: string) => enabledMap.get(id) ?? true;

  const togglePlugin = (id: string, name: string, version: string, path: string) => {
    const next = settings.plugins.filter((p) => p.id !== id);
    next.push({ id, name, version, path, enabled: !isEnabled(id) });
    patch("plugins", next);
  };

  const installFromPath = async () => {
    if (!installPath.trim()) return;
    setBusy(true);
    try {
      const trimmed = installPath.trim();
      const id = trimmed.split("/").pop()?.replace(".json", "") ?? "plugin";
      const name = id;
      const next: PluginConfig[] = [
        ...settings.plugins.filter((p) => p.id !== id),
        {
          id,
          name,
          version: "0.0.1",
          path: trimmed,
          enabled: true,
        },
      ];
      patch("plugins", next);
      setInstallPath("");
    } finally {
      setBusy(false);
    }
  };

  const uninstall = (id: string) => {
    patch(
      "plugins",
      settings.plugins.filter((p) => p.id !== id),
    );
  };

  const rescan = () => {
    const map = new Map(settings.plugins.map((p) => [p.id, p]));
    setPlugins(
      DEFAULT_LOCAL.map((p) => {
        const stored = map.get(p.id);
        return stored
          ? { ...p, name: stored.name || p.name, version: stored.version || p.version }
          : p;
      }),
    );
  };

  const selected = plugins.find((p) => p.id === selectedId) ?? null;
  const selectedConfig = settings.plugins.find((p) => p.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={installPath}
            onChange={(e) => setInstallPath(e.target.value)}
            placeholder="Install from local path (manifest.json or .qx package)"
            style={{
              flex: 1,
              height: 30,
              padding: "0 10px",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-surface)",
              color: "var(--color-text-primary)",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            onClick={installFromPath}
            disabled={busy || !installPath.trim()}
            style={{
              height: 30,
              padding: "0 12px",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-surface)",
              color: "var(--color-text-primary)",
              fontSize: 12,
              cursor: busy || !installPath.trim() ? "default" : "pointer",
              opacity: !installPath.trim() || busy ? 0.6 : 1,
            }}
          >
            Install
          </button>
          <button
            onClick={rescan}
            style={{
              height: 30,
              padding: "0 12px",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-surface)",
              color: "var(--color-text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
            title="Rescan ~/.qx/plugins/"
          >
            Rescan
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", borderRight: "1px solid var(--color-border)" }}>
          {plugins.map((p) => {
            const active = p.id === selectedId;
            const enabled = isEnabled(p.id);
            return (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  padding: "12px 20px",
                  cursor: "pointer",
                  background: active ? "var(--color-surface-active)" : "transparent",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        marginTop: 2,
                      }}
                    >
                      v{p.version}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      value={enabled}
                      onChange={() => togglePlugin(p.id, p.name, p.version, p.path)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {plugins.length === 0 && (
            <div
              style={{
                padding: "32px 20px",
                color: "var(--color-text-tertiary)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No plugins installed
            </div>
          )}
        </div>

        <div style={{ width: 280, flexShrink: 0, padding: 16, overflowY: "auto" }}>
          {selected ? (
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {selected.name}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <Badge>v{selected.version}</Badge>
                <Badge>Local</Badge>
                <Badge>{isEnabled(selected.id) ? "Enabled" : "Disabled"}</Badge>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  marginTop: 12,
                  lineHeight: 1.5,
                }}
              >
                {selected.description}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 12,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                  wordBreak: "break-all",
                }}
              >
                {selected.path}
              </div>
              <div
                style={{
                  marginTop: 16,
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Permissions</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  <li>Read clipboard history</li>
                  <li>Open external links</li>
                  <li>Store data in ~/.qx/</li>
                </ul>
              </div>
              {selectedConfig && (
                <button
                  onClick={() => uninstall(selected.id)}
                  style={{
                    marginTop: 20,
                    height: 28,
                    padding: "0 12px",
                    border: "1px solid rgba(220,38,38,0.3)",
                    borderRadius: 6,
                    background: "var(--color-surface)",
                    color: "#dc2626",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Uninstall
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                color: "var(--color-text-tertiary)",
                fontSize: 13,
                textAlign: "center",
                padding: "32px 0",
              }}
            >
              Select a plugin to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
