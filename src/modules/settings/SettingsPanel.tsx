import { useEffect, useMemo, useState } from "react";
import { useSettingsStore, type SettingsTab } from "./store";
import GeneralSettings from "./GeneralSettings";
import PluginManager from "./PluginManager";
import ShortcutSettings from "./ShortcutSettings";
import AppearanceSettings from "./AppearanceSettings";
import AdvancedSettings from "./AdvancedSettings";

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: "⚙" },
  { id: "plugins", label: "Extensions", icon: "🧩" },
  { id: "shortcuts", label: "Shortcuts", icon: "⌨" },
  { id: "appearance", label: "Appearance", icon: "✦" },
  { id: "advanced", label: "Advanced", icon: "⚡" },
];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  plugins: "Extensions",
  shortcuts: "Shortcuts",
  appearance: "Appearance",
  advanced: "Advanced",
};

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { activeTab, setActiveTab, load, loaded } = useSettingsStore();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const filteredNav = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q));
  }, [filter]);

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "plugins":
        return <PluginManager />;
      case "shortcuts":
        return <ShortcutSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "advanced":
        return <AdvancedSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="qx-raycast">
      <div className="qx-plugin-toolbar">
        <div className="qx-search-wrap">
        <span className="qx-search-icon">⌕</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (filter) setFilter("");
              else onClose();
            }
          }}
          placeholder="Search settings..."
          autoFocus
          className="qx-plugin-search"
        />
        </div>
        <span
          style={{
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          Qx v0.1.0
        </span>
      </div>

      <div className="qx-settings-layout">
        <nav className="qx-settings-sidebar">
          {filteredNav.map((item) => {
            const active = item.id === activeTab;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`qx-settings-nav-item${active ? " is-active" : ""}`}
              >
                <span style={{ width: 16, textAlign: "center", fontSize: 13 }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
          {filteredNav.length === 0 && (
            <div
              style={{
                padding: "16px 10px",
                color: "var(--color-text-tertiary)",
                fontSize: 12,
              }}
            >
              No matching settings
            </div>
          )}
        </nav>

        <section className="qx-settings-content">
          <div className="qx-settings-title">
            {TAB_LABELS[activeTab]}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>{renderContent()}</div>
        </section>
      </div>
    </div>
  );
}
