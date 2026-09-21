import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { IS_WINDOWS_HOST, USE_EXPLICIT_WINDOW_RESIZE_HANDLES, WINDOW_RESIZE_HANDLES, startWindowResize, startWindowDrag } from "./qx-shell/windowChrome";
import { Home } from "lucide-react";
import { type BottomIslandContent } from "./QxBottomIsland";
import ShellActionButton, { type QxShellAction } from "./ShellActionButton";
import { ActionExecutionContext } from "./qx-shell/ActionExecutionContext";
import type { QxShellActionMenuRequest } from "./qx-shell/actionProtocol";
import { invoke } from "@tauri-apps/api/core";
import { useShellActions } from "./qx-shell/useShellActions";
import { useShellBottomBar } from "./qx-shell/useShellBottomBar";
import ShellActionMenu, {
  QX_ACTION_MENU_TRIGGER_ATTR,
} from "./ShellActionMenu";
import {
  useQxShellNavigation,
  type QxShellNavigation,
} from "../hooks/useQxShellNavigation";
import { getQxShortcutPreset } from "../utils/keyboard";
import QxIslandDockSlot from "../island/surface/QxIslandDockSlot";
import { useShellIslandShim } from "../island/compat/useShellIslandShim";
import { inferBottomIslandPriority } from "../island/compat/mapBottomIslandContent";
import type {
  IslandOpenTarget,
  IslandPlacementMode,
  IslandPriority,
  IslandSource,
} from "../island/types";
import { defaultIslandOpenTarget } from "../island/session/openTarget";
import { goHomeToLauncher } from "../modules/settings/openSettings";
import { useT } from "../i18n";
import { Select } from "./ui";
import QxWindowTitleBar from "./QxWindowTitleBar";
import QxContextSplit from "./QxContextSplit";
import { useSettingsStore } from "../modules/settings/store";

export type { BottomIslandContent } from "./QxBottomIsland";
export type { QxShellAction, QxShellActionMenuRequest } from "./qx-shell/actionProtocol";

export interface QxShellTopbarFilter {
  /** Stable, non-localized filter identity. */
  id: string;
  /** Accessible name for the host-rendered Select. */
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
}

interface QxShellProps {
  title: string;
  visual?: "solid" | "elevated" | "glass";
  /** Scroll the content itself, or let child panes own scrolling. */
  contentMode?: "scroll" | "fill";
  search?: ReactNode;
  leading?: ReactNode;
  /** Host-owned content filters. Modules and plugins publish data, never filter DOM. */
  topbarFilters?: QxShellTopbarFilter[];
  trailing?: ReactNode;
  children: ReactNode;
  context?: ReactNode;
  island?: BottomIslandContent | null;
  /**
   * Classified exception or transitional custom chrome (e.g. ScreenRecorder).
   * Idle preview only; never suppresses errors, tasks or toasts.
   */
  customIsland?: ReactNode;
  /**
   * Stable, non-localized identity for the shell island session.
   * Visible titles must never be used as protocol identity.
   */
  islandKey: string;
  islandSource?: IslandSource;
  islandPriority?: IslandPriority;
  islandSticky?: boolean;
  islandPlacement?: IslandPlacementMode;
  islandOpenTarget?: IslandOpenTarget;
  /**
   * When true, do not write island prop into the store (caller owns session,
   * e.g. Launcher home/search via islandHost).
   */
  islandManagedExternally?: boolean;
  escapeAction?: QxShellAction;
  actions?: QxShellAction[];
  /** Stable id projected to the Bottom Bar and unmodified Enter. */
  primaryActionId?: string;
  actionTitle?: string;
  /** Opens the shared Actions menu beside a contextual pointer location. */
  actionMenuRequest?: QxShellActionMenuRequest | null;
  /**
   * Bottom-bar house control → main launcher. Defaults on for non-launcher
   * surfaces (`islandKey !== "launcher"`). Pass `null` to hide explicitly.
   */
  onGoHome?: (() => void) | null;
  className?: string;
  style?: CSSProperties;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  overlayBottom?: boolean;
  navigation?: QxShellNavigation;
}

const QxShell = forwardRef<HTMLDivElement, QxShellProps>(function QxShell({
  title,
  visual = "solid",
  contentMode = "scroll",
  search,
  leading,
  topbarFilters,
  trailing,
  children,
  context,
  island,
  customIsland,
  islandKey,
  islandSource = "module",
  islandPriority,
  islandSticky = false,
  islandPlacement = "docked-or-float",
  islandOpenTarget,
  islandManagedExternally = false,
  escapeAction,
  actions,
  primaryActionId,
  actionTitle,
  actionMenuRequest,
  onGoHome,
  className = "",
  style,
  onKeyDown,
  overlayBottom,
  navigation,
}, ref) {
  const t = useT();
  const showTitleBar = useSettingsStore((state) => state.settings.appearance.title_bar_visible);
  const isLauncherSurface = islandKey === "launcher";
  const resolvedIslandOpenTarget = useMemo(
    () => islandOpenTarget ?? defaultIslandOpenTarget(islandKey, islandSource),
    [islandKey, islandOpenTarget, islandSource],
  );
  const resolvedIslandPriority = islandPriority ?? inferBottomIslandPriority(island);
  useShellIslandShim({
    island: islandManagedExternally ? null : island,
    routeKey: islandKey,
    source: islandSource,
    priority: resolvedIslandPriority,
    sticky: islandSticky,
    placement: islandPlacement,
    openTarget: resolvedIslandOpenTarget,
    suppressed: islandManagedExternally,
  });

  const fallbackEscapeAction: QxShellAction = {
    id: "escape", label: isLauncherSurface ? t("shell.hide", "Hide") : t("common.back", "Back"), kbd: "Esc",
    onClick: isLauncherSurface ? () => invoke<void>("floating_hide_restore_focus") : goHomeToLauncher,
  };
  const visibleEscapeAction = useMemo(() => {
    const base = escapeAction ?? fallbackEscapeAction;
    // Normalize legacy "Esc"-only labels to Back / Hide for the visible capsule.
    if (base.label === "Esc" || !base.label?.trim()) {
      return {
        ...base,
        label: isLauncherSurface
          ? t("shell.hide", "Hide")
          : t("common.back", "Back"),
      };
    }
    return base;
  }, [escapeAction, fallbackEscapeAction, isLauncherSurface, t]);
  const showHomeButton = !isLauncherSurface && onGoHome !== null;
  const handleGoHome = useCallback(() => {
    if (typeof onGoHome === "function") {
      onGoHome();
      return;
    }
    goHomeToLauncher();
  }, [onGoHome]);
  const hasLeading = Boolean(leading);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const islandOverlapsActions = useShellBottomBar(shellRef);
  const assignShellRef = useCallback((element: HTMLDivElement | null) => {
    shellRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }, [ref]);

  const {
    activeRegionId,
    handleNavigationKeyDown,
    handleRegionFocusCapture,
    handleRegionPointerCapture,
  } = useQxShellNavigation({ shellRef, content: children, context });

  const { actionExecution, primaryAction, showActionMenu, hasRightActions, menuActions, actionMenuOpen, handleActionMenuOpenChange, activeMenuTitle, activeMenuActions, actionIndex, setActionIndex, runMenuAction, menuStack, popMenuLevel, currentMenuLevel, menuQuery, setMenuQuery, submenuLoading, actionMenuAnchorPoint, openActionMenu, handleKeyDownCapture, handleKeyDown, handleContextMenu } = useShellActions({ actions, primaryActionId, actionTitle, title, islandKey, actionMenuRequest, shellRef, activeRegionId, navigation, handleNavigationKeyDown, onKeyDown, visibleEscapeAction });

  return (
    <ActionExecutionContext.Provider value={actionExecution}>
    <div
      ref={assignShellRef}
      className={`qx-shell visual-${visual} ${IS_WINDOWS_HOST ? "is-windows-host" : "is-macos-host"} ${showTitleBar ? "has-window-titlebar" : ""} ${context ? "has-context" : ""} ${overlayBottom ? "qx-shell-overlay-bottom" : ""} ${className}`}
      style={style}
      data-content-mode={contentMode}
      aria-label={title}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      onFocusCapture={handleRegionFocusCapture}
      onPointerDownCapture={handleRegionPointerCapture}
      tabIndex={0}
    >
      {USE_EXPLICIT_WINDOW_RESIZE_HANDLES
        ? WINDOW_RESIZE_HANDLES.map(({ direction, className: handleClass }) => (
            <div
              key={direction}
              className={`qx-shell-resize-handle ${handleClass}`}
              aria-hidden="true"
              onPointerDown={(event) => startWindowResize(event, direction)}
            />
          ))
        : null}

      {showTitleBar ? <QxWindowTitleBar title={title} /> : null}

      <div
        className={`qx-shell-topbar${hasLeading ? "" : " no-leading"}`}
        onPointerDown={startWindowDrag}
      >
        {IS_WINDOWS_HOST && !showTitleBar ? (
          <div
            className="qx-shell-window-drag-handle"
            data-qx-window-drag-handle
            aria-hidden="true"
          />
        ) : null}
        {leading}
        <div className="qx-shell-search-slot">{search}</div>
        {(topbarFilters?.length || trailing) ? (
          <div className="qx-shell-trailing">
            {topbarFilters?.length ? (
              <div
                className="qx-shell-filter-slot"
                role="group"
                aria-label={t("shell.contentFilters", "Content filters")}
              >
                {topbarFilters.map((filter) => (
                  <Select
                    key={filter.id}
                    value={filter.value}
                    options={filter.options}
                    ariaLabel={filter.label}
                    className="qx-shell-content-filter"
                    onChange={filter.onChange}
                  />
                ))}
              </div>
            ) : null}
            {trailing ? <div className="qx-shell-trailing-extra">{trailing}</div> : null}
          </div>
        ) : null}
      </div>

      {context ? (
        <QxContextSplit
          context={context}
          separatorLabel={t("shell.resizeContext", "Resize or hide context panel")}
        >
          {children}
        </QxContextSplit>
      ) : (
        <div className="qx-shell-main">
          <main className="qx-shell-content">{children}</main>
        </div>
      )}

      <div
        className="qx-shell-bottombar"
        data-island-overlap={islandOverlapsActions ? "true" : undefined}
      >
        <div className="qx-shell-left">
          {showHomeButton ? (
            <button
              type="button"
              className="qx-shell-action variant-escape qx-shell-home"
              onClick={handleGoHome}
              title={t("shell.goHome", "Home")}
              aria-label={t("shell.goHome", "Home")}
            >
              <Home size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {/* Custom previews may only replace idle content, never active feedback. */}
        <QxIslandDockSlot exception={customIsland} />
        <div className={`qx-shell-actions${hasRightActions ? "" : " has-escape-only"}`}>
          {hasRightActions ? (
            <>
              <ShellActionButton action={primaryAction} variant="primary" />
              {showActionMenu ? (
                <ShellActionButton
                  action={{
                    id: "qx.actions",
                    label: t("common.actions", "Action"),
                    kbd: getQxShortcutPreset().actionMenu,
                    onClick: openActionMenu,
                  }}
                  onRun={() => openActionMenu()}
                  triggerAttrs={{ [QX_ACTION_MENU_TRIGGER_ATTR]: true }}
                />
              ) : null}
            </>
          ) : null}
          <ShellActionButton action={visibleEscapeAction} variant="escape" />
        </div>
      </div>
      {/* Keep mounted so Radix/shadcn can play open/close animations. */}
      {(menuActions.length > 0 || actionMenuOpen) && (
        <ShellActionMenu
          open={actionMenuOpen}
          onOpenChange={handleActionMenuOpenChange}
          title={activeMenuTitle}
          actions={activeMenuActions}
          activeIndex={actionIndex}
          onHover={setActionIndex}
          onRun={runMenuAction}
          canGoBack={menuStack.length > 1}
          onBack={popMenuLevel}
          searchable={Boolean(currentMenuLevel?.searchable)}
          searchQuery={menuQuery}
          onSearchQueryChange={(value) => {
            setMenuQuery(value);
            setActionIndex(0);
          }}
          searchPlaceholder={
            currentMenuLevel?.searchPlaceholder ?? t("shell.filterActions", "Filter…")
          }
          loading={submenuLoading}
          anchorPoint={actionMenuAnchorPoint}
        />
      )}
    </div>
    </ActionExecutionContext.Provider>
  );
});

export default QxShell;
