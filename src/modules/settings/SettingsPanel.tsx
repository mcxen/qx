import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CloudSun,
  Info,
  Keyboard,
  Palette,
  Puzzle,
  Rss,
  ScanText,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Files,
} from "lucide-react";
import { useSettingsStore, type SettingsTab } from "./store";
import GeneralSettings from "./GeneralSettings";
import ShortcutSettings from "./ShortcutSettings";
import PluginManager from "./PluginManager";
import PermissionSettings from "./PermissionSettings";
import AppearanceSettings from "./AppearanceSettings";
import RssSettings from "./RssSettings";
import AdvancedSettings from "./AdvancedSettings";
import OcrSettings from "./OcrSettings";
import AgentSettings from "./AgentSettings";
import WeatherSettings from "./WeatherSettings";
import AboutPanel from "./AboutPanel";
import FileSearchSettings from "./FileSearchSettings";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { Button, ScrollArea } from "../../components/ui";
import { useT } from "../../i18n";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { homeIslandDataBus, useResolvedHomeIsland } from "../../home-island";
import { QxIslandSurface } from "../../island";
import { isBuiltinModuleEnabled } from "../moduleAvailability";

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Settings navigation — grouped by user intent, not by implementation.
 *
 *  基础 (Basics)     app-wide prefs everyone uses
 *  扩展 (Extensions)  installable / marketplace surface
 *  功能 (Features)    built-in module prefs (AI, OCR, RSS, Weather)
 *  系统 (System)      OS permissions, developer, about
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Basics",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      { id: "file-search", label: "File Search", icon: Files },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
    ],
  },
  {
    label: "Extensions",
    items: [
      { id: "plugins", label: "Extensions", icon: Puzzle },
    ],
  },
  {
    label: "Features",
    items: [
      { id: "agent", label: "AI Agent", icon: Bot },
      { id: "ocr", label: "OCR", icon: ScanText },
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
  "file-search": "File Search",
  shortcuts: "Shortcuts",
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
  const { activeTab, setActiveTab, load, loaded, settings } = useSettingsStore();
  const t = useT();
  const [filter, setFilter] = useState("");
  const [version, setVersion] = useState("");
  /** Mode the user is hovering / focusing in Home Island settings. */
  const [homePreviewMode, setHomePreviewMode] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  // Raycast "Configure Extension" (and similar) land here via sessionStorage.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("qx.settings.pendingTab");
      if (pending === "plugins") {
        sessionStorage.removeItem("qx.settings.pendingTab");
        setActiveTab("plugins");
      }
    } catch {
      /* ignore */
    }
  }, [setActiveTab]);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  // Appearance tab: keep metrics bus warm so live preview has real data.
  useEffect(() => {
    if (activeTab !== "appearance") {
      setHomePreviewMode(null);
      return;
    }
    homeIslandDataBus.kick();
    const id = window.setInterval(() => homeIslandDataBus.kick(), 4000);
    return () => window.clearInterval(id);
  }, [activeTab]);

  const appearance = settings.appearance;
  const homePreview = useResolvedHomeIsland(
    {
      home_island_mode: appearance.home_island_mode,
      home_island_modes: appearance.home_island_modes,
      home_island_rotate_secs: appearance.home_island_rotate_secs,
      home_island_cpu: appearance.home_island_cpu,
      home_island_gpu: appearance.home_island_gpu,
      home_island_memory: appearance.home_island_memory,
    },
    t,
    {
      previewMode: homePreviewMode,
      // While picking cards, pin the focused mode; still rotate if multi-select and no focus.
      pauseRotate: Boolean(homePreviewMode),
    },
  );

  const navGroups = useMemo(() => {
    const availableGroups = NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.id !== "weather" || isBuiltinModuleEnabled("weather", settings)),
      }))
      .filter((group) => group.items.length > 0);
    if (!filter.trim()) return availableGroups;
    return availableGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          t(`nav.${item.id}`, item.label).toLowerCase().includes(filter.trim().toLowerCase()),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [filter, settings, t]);

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "file-search":
        return <FileSearchSettings />;
      case "shortcuts":
        return <ShortcutSettings />;
      case "plugins":
        return <PluginManager />;
      case "permissions":
        return <PermissionSettings />;
      case "appearance":
        return <AppearanceSettings onHomeIslandPreview={setHomePreviewMode} />;
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

  const settingsSearch = (
    <QxModuleSearch
      value={filter}
      onChange={setFilter}
      onFocus={requestPanelKeyWindow}
      placeholder={t("settings.search", "Search settings...")}
    />
  );

  const settingsContext = (
    <nav className="qx-settings-sidebar">
      {navGroups.map((group) => (
        <div key={group.label} className="qx-settings-nav-group">
          <div className="qx-settings-nav-group-label">
            {t(
              `settings.navGroup.${group.label.toLowerCase()}`,
              group.label,
            )}
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

  const settingsActions = useMemo<QxShellAction[]>(() => {
    const jump: QxShellAction[] = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({
        label: t(`nav.${item.id}`, item.label),
        onClick: () => setActiveTab(item.id),
      })),
    );
    return [
      {
        label: t("settings.close", "Close"),
        onClick: onClose,
      },
      ...jump,
    ];
  }, [onClose, setActiveTab, t]);

  const showHomeIslandPreview = activeTab === "appearance";
  const settingsIsland =
    showHomeIslandPreview && homePreview.shellContent
      ? homePreview.shellContent
      : showHomeIslandPreview
        ? null
        : {
            label: t("launcher.settings", "Settings"),
            detail: t(`nav.${activeTab}`, TAB_LABELS[activeTab]),
          };

  // Local Surface preview — does not write global `home` session.
  const homePreviewIsland =
    showHomeIslandPreview && homePreview.customNode ? (
      <QxIslandSurface
        placement="docked"
        variant={homePreview.chromeVariant ?? "shell"}
        aria-label={homePreview.modeId}
      >
        {homePreview.customNode}
      </QxIslandSurface>
    ) : undefined;

  const shell = useQxModuleShell({
    leave: onClose,
    esc: {
      query: { active: filter.length > 0, clear: () => setFilter("") },
    },
    actionsLabel: t("launcher.actions", "Actions"),
    island: settingsIsland,
    t,
  });

  return (
    <QxShell
      title={t("launcher.settings", "Settings")}
      visual="elevated"
      islandKey="settings"
      search={settingsSearch}
      trailing={<span className="qx-shell-meta">Qx v{version || "..."}</span>}
      context={settingsContext}
      island={shell.island}
      customIsland={homePreviewIsland}
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      primaryAction={{
        label: t("settings.close", "Close"),
        onClick: onClose,
      }}
      secondaryAction={shell.secondaryAction}
      actionTitle={t("settings.actions", "Settings Actions")}
      actions={settingsActions}
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
