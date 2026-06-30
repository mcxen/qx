import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore, type SettingsTab } from "./store";
import GeneralSettings from "./GeneralSettings";
import PluginManager from "./PluginManager";
import ShortcutSettings from "./ShortcutSettings";
import PermissionSettings from "./PermissionSettings";
import AppearanceSettings from "./AppearanceSettings";
import RssSettings from "./RssSettings";
import AdvancedSettings from "./AdvancedSettings";
import OcrSettings from "./OcrSettings";
import AgentSettings from "./AgentSettings";
import WeatherSettings from "./WeatherSettings";
import AboutPanel from "./AboutPanel";
import QxShell from "../../components/QxShell";
import { useT } from "../../i18n";

interface NavItem {
  id: SettingsTab;
  label: string;
  code: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", code: "GN" },
  { id: "plugins", label: "Extensions", code: "EX" },
  { id: "shortcuts", label: "Shortcuts", code: "SC" },
  { id: "permissions", label: "Permissions", code: "PM" },
  { id: "appearance", label: "Appearance", code: "AP" },
  { id: "agent", label: "AI Agent", code: "AI" },
  { id: "rss", label: "RSS Reader", code: "RS" },
  { id: "weather", label: "Weather", code: "WT" },
  { id: "ocr", label: "OCR", code: "OC" },
  { id: "advanced", label: "Advanced", code: "AD" },
  { id: "about", label: "About", code: "AB" },
];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  plugins: "Extensions",
  shortcuts: "Shortcuts",
  permissions: "Permissions",
  appearance: "Appearance",
  agent: "AI Agent",
  rss: "RSS Reader",
  weather: "Weather",
  ocr: "OCR",
  advanced: "Advanced",
  about: "About",
};

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { activeTab, setActiveTab, load, loaded } = useSettingsStore();
  const t = useT();
  const [filter, setFilter] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  const filteredNav = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((n) => t(`nav.${n.id}`, n.label).toLowerCase().includes(q));
  }, [filter, t]);

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "plugins":
        return <PluginManager />;
      case "shortcuts":
        return <ShortcutSettings />;
      case "permissions":
        return <PermissionSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "agent":
        return <AgentSettings />;
      case "rss":
        return <RssSettings />;
      case "weather":
        return <WeatherSettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "ocr":
        return <OcrSettings />;
      case "about":
        return <AboutPanel />;
      default:
        return null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (filter && filteredNav.length > 0) {
      setFilter("");
    } else {
      onClose();
    }
  };

  const settingsSearch = (
    <div className="qx-search-wrap">
        <span className="qx-search-icon" aria-hidden="true" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("settings.search", "Search settings...")}
          autoFocus
          className="qx-plugin-search"
        />
    </div>
  );

  const settingsContext = (
    <nav className="qx-settings-sidebar">
      {filteredNav.map((item) => {
        const active = item.id === activeTab;
        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`qx-settings-nav-item${active ? " is-active" : ""}`}
          >
            <span className="qx-settings-nav-code">{item.code}</span>
            <span className="qx-settings-nav-label">{t(`nav.${item.id}`, item.label)}</span>
          </button>
        );
      })}
      {filteredNav.length === 0 && (
        <div
          style={{
            padding: "16px 10px",
            color: "var(--qx-text-tertiary)",
            fontSize: 12,
          }}
        >
          {t("settings.noMatches", "No matching settings")}
        </div>
      )}
    </nav>
  );

  return (
    <QxShell
      title={t("launcher.settings", "Settings")}
      visual="elevated"
      search={settingsSearch}
      trailing={<span className="qx-shell-meta">Qx v{version || "..."}</span>}
      context={settingsContext}
      island={{ label: t("launcher.settings", "Settings"), detail: t(`nav.${activeTab}`, TAB_LABELS[activeTab]) }}
      escapeAction={{ label: t("settings.close", "Close"), kbd: "Esc", onClick: onClose }}
      onKeyDown={handleKeyDown}
    >
      <section className="qx-settings-content">
        <div className="qx-settings-title">{t(`nav.${activeTab}`, TAB_LABELS[activeTab])}</div>
        <div className={`qx-settings-body${activeTab === "plugins" ? " is-plugin-manager" : ""}`}>
          {renderContent()}
        </div>
      </section>
    </QxShell>
  );
}
