import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CloudSun,
  Info,
  Palette,
  Puzzle,
  Rss,
  ScanText,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useSettingsStore, type SettingsTab } from "./store";
import GeneralSettings from "./GeneralSettings";
import PluginManager from "./PluginManager";
import PermissionSettings from "./PermissionSettings";
import AppearanceSettings from "./AppearanceSettings";
import RssSettings from "./RssSettings";
import AdvancedSettings from "./AdvancedSettings";
import OcrSettings from "./OcrSettings";
import AgentSettings from "./AgentSettings";
import WeatherSettings from "./WeatherSettings";
import AboutPanel from "./AboutPanel";
import QxShell from "../../components/QxShell";
import { Button, ScrollArea } from "../../components/ui";
import { useT } from "../../i18n";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Core",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "plugins", label: "Extensions", icon: Puzzle },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "agent", label: "AI Agent", icon: Bot },
      { id: "ocr", label: "OCR", icon: ScanText },
    ],
  },
  {
    label: "Modules",
    items: [
      { id: "rss", label: "RSS Reader", icon: Rss },
      { id: "weather", label: "Weather", icon: CloudSun },
    ],
  },
  {
    label: "System",
    items: [
      { id: "permissions", label: "Permissions", icon: ShieldCheck },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
      { id: "about", label: "About", icon: Info },
    ],
  },
];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  plugins: "Extensions",
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

  const navGroups = useMemo(() => {
    if (!filter.trim()) return NAV_GROUPS;
    return NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          t(`nav.${item.id}`, item.label).toLowerCase().includes(filter.trim().toLowerCase()),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [filter, t]);

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "plugins":
        return <PluginManager />;
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
    if (filter && navGroups.length > 0) {
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
        onFocus={requestPanelKeyWindow}
        placeholder={t("settings.search", "Search settings...")}
        autoFocus
        className="qx-plugin-search"
      />
    </div>
  );

  const settingsContext = (
    <nav className="qx-settings-sidebar">
      {navGroups.map((group) => (
        <div key={group.label} className="qx-settings-nav-group">
          <div className="qx-settings-nav-group-label">
            {t(`settings.navGroup.${group.label.toLowerCase()}`, group.label)}
          </div>
          {group.items.map((item) => {
            const active = item.id === activeTab;
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                onClick={() => setActiveTab(item.id)}
                className={`qx-settings-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="qx-settings-nav-icon" aria-hidden="true">
                  <Icon size={14} strokeWidth={2} />
                </span>
                <span className="qx-settings-nav-label">{t(`nav.${item.id}`, item.label)}</span>
              </Button>
            );
          })}
        </div>
      ))}
      {navGroups.length === 0 && (
        <div className="qx-settings-empty">
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
          {activeTab === "plugins" ? (
            renderContent()
          ) : (
            <ScrollArea className="qx-settings-scroll">{renderContent()}</ScrollArea>
          )}
        </div>
      </section>
    </QxShell>
  );
}
