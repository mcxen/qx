import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppWindow,
  Cpu,
  EyeOff,
  MemoryStick,
  Monitor,
  Network,
  Pin,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button, Slider } from "../components/ui";
import type { SystemStatsSnapshot } from "../home-island/data/types";
import { ThemeProvider } from "../ThemeProvider";
import { useLocale, useT } from "../i18n";
import { isTrayStatusAction, sanitizeTrayActions } from "../modules/settings/trayActions";
import type { Settings as QxSettings, TrayActionConfig } from "../modules/settings/store";
import type { InstalledPlugin } from "../plugin/types";
import {
  orderedEnabledProviders,
  readDisplayBrightnessProvider,
  resolveSurfaceProviders,
  nextBrightnessRampValue,
  BRIGHTNESS_RAMP_INTERVAL_MS,
  writeDisplayBrightnessProvider,
  type DisplayBrightnessProviderItem,
} from "../plugin/surfaceProviders";
import {
  TrayControlCard,
  TraySection,
  TrayShortcutButton,
  TrayShortcutGrid,
  TrayStatusRow,
  TraySurfaceFrame,
} from "./TraySurface";
import {
  measureTraySurface,
  trayShortcutRows,
  type TraySurfaceRow,
  type TraySurfaceSize,
} from "./surface";

interface NetworkCounters {
  totalBytesIn: number;
  totalBytesOut: number;
}

interface NetworkSample extends NetworkCounters {
  at: number;
}

const TRAY_AUTO_HIDE_DELAY_MS = 2400;

type TraySegment =
  | { kind: "status"; actions: TrayActionConfig[] }
  | { kind: "actions"; actions: TrayActionConfig[] };

function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0B";
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)}B`;
  if (bytesPerSecond < 1024 ** 2) return `${(bytesPerSecond / 1024).toFixed(1)}K`;
  return `${(bytesPerSecond / 1024 ** 2).toFixed(1)}M`;
}

function segmentActions(actions: TrayActionConfig[]): TraySegment[] {
  return actions.reduce<TraySegment[]>((segments, action) => {
    const kind = isTrayStatusAction(action.id) ? "status" : "actions";
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.actions.push(action);
    else segments.push({ kind, actions: [action] });
    return segments;
  }, []);
}

function TrayContent() {
  const t = useT();
  const locale = useLocale();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [settings, setSettings] = useState<QxSettings | null>(null);
  const [displays, setDisplays] = useState<DisplayBrightnessProviderItem[]>([]);
  const [focusedDisplayId, setFocusedDisplayId] = useState<number | null>(null);
  const [stats, setStats] = useState<SystemStatsSnapshot | null>(null);
  const [networkRates, setNetworkRates] = useState({ down: 0, up: 0 });
  const [loading, setLoading] = useState(true);
  const [panelActive, setPanelActive] = useState(false);
  const pending = useRef(new Map<string, number>());
  const writeTimers = useRef(new Map<string, number>());
  const queuedBrightness = useRef(new Map<string, number>());
  const committedBrightness = useRef(new Map<string, number>());
  const writeInFlight = useRef(new Set<string>());
  const previousNetwork = useRef<NetworkSample | null>(null);
  const pointerInsidePanel = useRef(false);
  const autoHideTimer = useRef<number | null>(null);

  const cancelAutoHide = useCallback(() => {
    if (autoHideTimer.current !== null) {
      window.clearTimeout(autoHideTimer.current);
      autoHideTimer.current = null;
    }
  }, []);
  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    autoHideTimer.current = window.setTimeout(() => {
      autoHideTimer.current = null;
      if (!pointerInsidePanel.current) void invoke("tray_panel_hide").catch(() => {});
    }, TRAY_AUTO_HIDE_DELAY_MS);
  }, [cancelAutoHide]);
  const handlePointerEnter = useCallback(() => {
    pointerInsidePanel.current = true;
    cancelAutoHide();
  }, [cancelAutoHide]);
  const handlePointerLeave = useCallback(() => {
    pointerInsidePanel.current = false;
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  const providers = useMemo(() => orderedEnabledProviders(
    resolveSurfaceProviders(plugins, "tray", locale),
    settings?.tray_providers ?? [],
  ), [plugins, locale, settings?.tray_providers]);
  const enabledActions = useMemo(
    () => sanitizeTrayActions(settings?.tray_actions).filter((action) => action.enabled),
    [settings?.tray_actions],
  );
  const segments = useMemo(() => segmentActions(enabledActions), [enabledActions]);
  const brightnessEnabled = providers.some(
    (provider) => provider.declaration.source === "system.display-brightness",
  );
  const visibleDisplays = displays.filter((display) => display.supported && display.current != null);
  const orderedVisibleDisplays = useMemo(() => {
    if (focusedDisplayId == null) return visibleDisplays;
    const focused = visibleDisplays.find((display) => display.id.endsWith(`:${focusedDisplayId}`));
    if (!focused) return visibleDisplays;
    return [focused, ...visibleDisplays.filter((display) => display.id !== focused.id)];
  }, [focusedDisplayId, visibleDisplays]);
  const sizeRank: Record<TraySurfaceSize, number> = { compact: 0, standard: 1, wide: 2 };
  const providerSize = providers.reduce<TraySurfaceSize>((current, provider) => {
    const preferred = provider.declaration.presentation ?? "standard";
    return sizeRank[preferred] > sizeRank[current] ? preferred : current;
  }, "compact");
  const surfaceSize: TraySurfaceSize = enabledActions.length > 0 && providerSize === "compact"
    ? "standard"
    : providerSize;

  const refresh = useCallback(async () => {
    const wantsStats = enabledActions.some(
      (action) => action.id === "status_memory" || action.id === "status_cpu",
    );
    const wantsNetwork = enabledActions.some((action) => action.id === "status_network");
    const tasks: Promise<unknown>[] = [];

    if (brightnessEnabled) {
      tasks.push(readDisplayBrightnessProvider().then((next) => {
        setDisplays(next.map((display) => {
          const optimistic = pending.current.get(display.id);
          if (
            optimistic == null
            && !writeInFlight.current.has(display.id)
            && !queuedBrightness.current.has(display.id)
            && display.current != null
          ) {
            committedBrightness.current.set(display.id, Math.round(display.current));
          }
          return optimistic == null ? display : { ...display, current: optimistic };
        }));
      }));
    } else {
      setDisplays([]);
    }
    if (wantsStats) {
      tasks.push(invoke<SystemStatsSnapshot>("get_system_stats").then(setStats));
    }
    if (wantsNetwork) {
      tasks.push(invoke<NetworkCounters>("qx_system_monitor_network_counters").then((next) => {
        const now = performance.now();
        const previous = previousNetwork.current;
        if (previous) {
          const seconds = Math.max(0.001, (now - previous.at) / 1000);
          setNetworkRates({
            down: Math.max(0, (next.totalBytesIn - previous.totalBytesIn) / seconds),
            up: Math.max(0, (next.totalBytesOut - previous.totalBytesOut) / seconds),
          });
        }
        previousNetwork.current = { ...next, at: now };
      }));
    }

    try {
      await Promise.all(tasks);
    } finally {
      setLoading(false);
    }
  }, [brightnessEnabled, enabledActions]);

  useEffect(() => {
    let cancelled = false;
    const trayWindow = getCurrentWindow();
    void Promise.all([
      invoke<InstalledPlugin[]>("list_installed_plugins"),
      invoke<QxSettings>("get_settings"),
    ]).then(([nextPlugins, nextSettings]) => {
      if (cancelled) return;
      setPlugins(nextPlugins);
      setSettings(nextSettings);
    }).catch(() => setLoading(false));
    void trayWindow.isFocused().then((focused) => {
      if (!cancelled) setPanelActive(focused);
    });
    const unlistenFocus = trayWindow.onFocusChanged(({ payload }) => {
      setPanelActive(payload);
      if (payload) cancelAutoHide();
      else scheduleAutoHide();
    });
    return () => {
      cancelled = true;
      cancelAutoHide();
      void unlistenFocus.then((stop) => stop());
    };
  }, [cancelAutoHide, scheduleAutoHide]);

  useEffect(() => {
    // The Tray icon is above the panel, so the pointer may start outside the
    // WebView without ever producing a pointerleave event.
    scheduleAutoHide();
    return cancelAutoHide;
  }, [cancelAutoHide, scheduleAutoHide]);

  useEffect(() => {
    void invoke<number | null>("tray_panel_get_focus_display")
      .then((displayId) => setFocusedDisplayId(displayId));
    const unlisten = listen<number | null>("tray-focus-display", ({ payload }) => {
      setFocusedDisplayId(payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!panelActive) {
      setStats(null);
      previousNetwork.current = null;
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [panelActive, refresh]);

  useEffect(() => () => {
    writeTimers.current.forEach((timer) => window.clearTimeout(timer));
    writeTimers.current.clear();
    queuedBrightness.current.clear();
    committedBrightness.current.clear();
    writeInFlight.current.clear();
  }, []);

  useEffect(() => {
    const rows: TraySurfaceRow[] = [];
    let hasActionLabel = false;
    let hasStatusLabel = false;
    segments.forEach((segment) => {
      if (segment.kind === "actions") {
        if (!hasActionLabel) rows.push({ kind: "section-label" });
        hasActionLabel = true;
        rows.push({ kind: "shortcut-grid", rows: trayShortcutRows(segment.actions.length, surfaceSize) });
      } else {
        if (!hasStatusLabel) rows.push({ kind: "section-label" });
        hasStatusLabel = true;
        segment.actions.forEach(() => rows.push({ kind: "status" }));
      }
    });
    if (brightnessEnabled) {
      if (enabledActions.length > 0) rows.push({ kind: "section-label" });
      const cardCount = Math.max(visibleDisplays.length, loading ? 1 : 0);
      Array.from({ length: cardCount }, () => rows.push({ kind: "control" }));
    }
    void invoke("tray_panel_resize", measureTraySurface(surfaceSize, rows)).catch(() => {});
  }, [brightnessEnabled, enabledActions.length, loading, segments, surfaceSize, visibleDisplays.length]);

  const flushBrightnessWrite = (displayId: string) => {
    writeTimers.current.delete(displayId);
    if (writeInFlight.current.has(displayId)) return;
    const target = queuedBrightness.current.get(displayId);
    const committed = committedBrightness.current.get(displayId);
    if (target == null || committed == null) return;
    if (target === committed) {
      queuedBrightness.current.delete(displayId);
      pending.current.delete(displayId);
      void refresh();
      return;
    }

    const nextValue = nextBrightnessRampValue(committed, target);
    writeInFlight.current.add(displayId);
    void writeDisplayBrightnessProvider(displayId, nextValue)
      .then(() => {
        committedBrightness.current.set(displayId, nextValue);
      })
      .catch(() => {
        queuedBrightness.current.delete(displayId);
        pending.current.delete(displayId);
        committedBrightness.current.delete(displayId);
        void refresh();
      })
      .finally(() => {
        writeInFlight.current.delete(displayId);
        const latestTarget = queuedBrightness.current.get(displayId);
        const latestCommitted = committedBrightness.current.get(displayId);
        if (latestTarget != null && latestCommitted != null && latestTarget !== latestCommitted) {
          writeTimers.current.set(
            displayId,
            window.setTimeout(() => flushBrightnessWrite(displayId), BRIGHTNESS_RAMP_INTERVAL_MS),
          );
        } else {
          queuedBrightness.current.delete(displayId);
          pending.current.delete(displayId);
          writeTimers.current.set(
            displayId,
            window.setTimeout(() => {
              writeTimers.current.delete(displayId);
              void refresh();
            }, 350),
          );
        }
      });
  };

  const setBrightness = (display: DisplayBrightnessProviderItem, value: number) => {
    const nextValue = Math.round(value);
    const oldTimer = writeTimers.current.get(display.id);
    if (oldTimer != null) {
      window.clearTimeout(oldTimer);
      writeTimers.current.delete(display.id);
    }
    if (!committedBrightness.current.has(display.id)) {
      committedBrightness.current.set(display.id, Math.round(display.current ?? nextValue));
    }
    queuedBrightness.current.set(display.id, nextValue);
    pending.current.set(display.id, nextValue);
    setDisplays((current) => current.map((item) => (
      item.id === display.id ? { ...item, current: nextValue } : item
    )));
    if (!writeInFlight.current.has(display.id) && !writeTimers.current.has(display.id)) {
      writeTimers.current.set(
        display.id,
        window.setTimeout(() => flushBrightnessWrite(display.id), 40),
      );
    }
  };

  const runAction = (id: string) => void invoke("tray_panel_run_action", { actionId: id });
  const actionIcon = (id: string) => {
    if (id === "open_main") return <AppWindow size={16} />;
    if (id === "keep_visible") return <Pin size={16} />;
    if (id === "settings") return <Settings size={16} />;
    return <EyeOff size={16} />;
  };
  const actionTitle = (action: TrayActionConfig) => {
    const title = action.title.trim();
    const localized = (() => {
      switch (action.id) {
        case "status_memory":
          return ["Memory", "Status · Memory", "状态 · 内存"].includes(title)
            ? t("tray.action.statusMemory", "Memory")
            : null;
        case "status_cpu":
          return ["CPU", "Status · CPU", "状态 · CPU"].includes(title)
            ? t("tray.action.statusCpu", "CPU")
            : null;
        case "status_network":
          return ["Network", "Status · Network", "状态 · 网络"].includes(title)
            ? t("tray.action.statusNetwork", "Network")
            : null;
        case "open_main":
          return ["Open Main Window", "打开主窗口"].includes(title)
            ? t("tray.action.openMain", "Open Main Window")
            : null;
        case "keep_visible":
          return ["Keep Window Visible", "Window Display Mode", "窗口显示方式"].includes(title)
            ? t("tray.action.keepVisible", "Window Display Mode")
            : null;
        case "settings":
          return ["Settings", "设置"].includes(title)
            ? t("tray.action.settings", "Settings")
            : null;
        case "hide_main":
          return ["Hide Main Window", "隐藏主窗口"].includes(title)
            ? t("tray.action.hideMain", "Hide Main Window")
            : null;
        default:
          return null;
      }
    })();
    return localized ?? title;
  };
  const actionTrailing = (id: string) => {
    if (id !== "keep_visible") return undefined;
    const behavior = settings?.appearance.window_behavior;
    if (behavior === "auto-hide") return t("tray.windowMode.autoHide", "Auto Hide");
    if (behavior === "always-on-top") return t("tray.windowMode.onTop", "On Top");
    return t("tray.windowMode.normal", "Normal");
  };
  const statusIcon = (id: string) => {
    if (id === "status_cpu") return <Cpu size={15} />;
    if (id === "status_network") return <Network size={15} />;
    return <MemoryStick size={15} />;
  };
  const statusValue = (id: string) => {
    if (id === "status_cpu") return stats ? `${Math.round(stats.cpu)}%` : "—";
    if (id === "status_network") {
      return `↓${formatRate(networkRates.down)} ↑${formatRate(networkRates.up)}`;
    }
    return stats ? `${stats.memoryUsedGb.toFixed(1)}G · ${Math.round(stats.memory)}%` : "—";
  };
  const firstActionSegment = segments.findIndex((segment) => segment.kind === "actions");
  const firstStatusSegment = segments.findIndex((segment) => segment.kind === "status");
  const providerTitle = providers.find(
    (provider) => provider.declaration.source === "system.display-brightness",
  )?.title ?? t("tray.brightness", "Display Brightness");
  const hasContent = enabledActions.length > 0 || brightnessEnabled;

  return (
    <TraySurfaceFrame
      size={surfaceSize}
      icon={<Monitor size={16} aria-hidden="true" />}
      title={t("tray.title", "Qx Controls")}
      closeLabel={t("common.close", "Close")}
      onClose={() => void invoke("tray_panel_hide")}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      footer={<>
        <Button size="icon" variant="ghost" onClick={() => void refresh()} title={t("common.refresh", "Refresh")}>
          <RefreshCw size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => invoke("tray_panel_open_settings")} title={t("common.settings", "Settings")}>
          <Settings size={15} />
        </Button>
      </>}
    >
      {segments.map((segment, index) => segment.kind === "actions" ? (
        <TraySection key={`actions-${index}`} title={index === firstActionSegment ? t("tray.actions", "Quick Actions") : undefined}>
          <TrayShortcutGrid>
            {segment.actions.map((action) => (
              <TrayShortcutButton
                key={action.id}
                icon={actionIcon(action.id)}
                title={actionTitle(action)}
                description={actionTrailing(action.id)}
                onClick={() => runAction(action.id)}
              />
            ))}
          </TrayShortcutGrid>
        </TraySection>
      ) : (
        <TraySection key={`status-${index}`} title={index === firstStatusSegment ? t("tray.status", "System Status") : undefined}>
          {segment.actions.map((action) => (
            <TrayStatusRow
              key={action.id}
              icon={statusIcon(action.id)}
              title={actionTitle(action)}
              value={statusValue(action.id)}
            />
          ))}
        </TraySection>
      ))}
      {brightnessEnabled && (
        <TraySection
          className="is-controls"
          title={enabledActions.length > 0 ? providerTitle : undefined}
        >
          {orderedVisibleDisplays.map((display, displayIndex) => (
            <TrayControlCard
              key={display.id}
              title={display.name}
              value={`${Math.round(display.current ?? 0)}%`}
              current={displayIndex === 0 && focusedDisplayId != null}
            >
              <Slider
                value={display.current ?? 0}
                min={0}
                max={100}
                step={1}
                onChange={(value) => setBrightness(display, value)}
                ariaLabel={`${display.name} ${t("tray.brightness", "Brightness")}`}
                className="qx-tray-brightness-slider"
              />
            </TrayControlCard>
          ))}
          {!loading && visibleDisplays.length === 0 && (
            <div className="qx-tray-panel-empty">{t("tray.displays.empty", "No supported displays found.")}</div>
          )}
        </TraySection>
      )}
      {!hasContent && !loading && (
        <div className="qx-tray-panel-empty">
          {t("tray.providers.empty", "Enable Tray items or controls in Settings.")}
        </div>
      )}
      {loading && <div className="qx-tray-panel-loading">{t("common.loading", "Loading…")}</div>}
    </TraySurfaceFrame>
  );
}

export default function TrayPanelApp() {
  return <ThemeProvider><TrayContent /></ThemeProvider>;
}
