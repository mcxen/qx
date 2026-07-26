import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Home } from "lucide-react";
import { type BottomIslandContent } from "./QxBottomIsland";
import ShellActionButton, { type QxShellAction } from "./ShellActionButton";
import { validateQxShellActions } from "./qx-shell/actionProtocol";
import ShellActionMenu, {
  QX_ACTION_MENU_TRIGGER_ATTR,
  actionHasSubmenu,
} from "./ShellActionMenu";
import {
  useQxShellNavigation,
  type QxShellNavigation,
} from "../hooks/useQxShellNavigation";
import {
  getQxDesktopPlatform,
  getQxShortcutPreset,
  isImeCompositionEvent,
  isEditableTarget,
  isNativeEditingShortcut,
  isReservedGlobalShortcut,
  isReservedGlobalShortcutEvent,
  matchesQxShortcut,
  shouldIgnoreBareShortcut,
} from "../utils/keyboard";
import QxIslandDockSlot from "../island/surface/QxIslandDockSlot";
import { useShellIslandShim } from "../island/compat/useShellIslandShim";
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

export type { BottomIslandContent } from "./QxBottomIsland";
export type { QxShellAction } from "./ShellActionButton";

export interface QxShellTopbarFilter {
  /** Stable, non-localized filter identity. */
  id: string;
  /** Accessible name for the host-rendered Select. */
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
}

export interface QxShellActionMenuRequest {
  /** Monotonic identity; repeated coordinates still open a fresh request. */
  id: number;
  /** Viewport/client coordinates supplied by a context-menu pointer event. */
  x: number;
  y: number;
}

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const WINDOW_RESIZE_HANDLES: Array<{
  direction: ResizeDirection;
  className: string;
}> = [
  { direction: "North", className: "edge-top" },
  { direction: "NorthEast", className: "corner-top-right" },
  { direction: "East", className: "edge-right" },
  { direction: "SouthEast", className: "corner-bottom-right" },
  { direction: "South", className: "edge-bottom" },
  { direction: "SouthWest", className: "corner-bottom-left" },
  { direction: "West", className: "edge-left" },
  { direction: "NorthWest", className: "corner-top-left" },
];

// Tauri/tao maps this API to WM_NCLBUTTONDOWN on Windows. macOS explicitly
// reports it as unsupported, so Cocoa/NSPanel must retain its native resizable
// edge hit testing instead of having a WebView overlay consume the pointer.
const IS_WINDOWS_HOST = getQxDesktopPlatform() === "windows";
const USE_EXPLICIT_WINDOW_RESIZE_HANDLES = IS_WINDOWS_HOST;

interface QxShellProps {
  title: string;
  visual?: "solid" | "elevated" | "glass";
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
   * Suppresses store docked winner while mounted.
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
  onBack?: () => void;
  backLabel?: string;
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
  islandPriority = "location",
  islandSticky = false,
  islandPlacement = "docked-or-float",
  islandOpenTarget,
  islandManagedExternally = false,
  escapeAction,
  actions,
  primaryActionId,
  actionTitle,
  actionMenuRequest,
  onBack,
  backLabel = "Back",
  onGoHome,
  className = "",
  style,
  onKeyDown,
  overlayBottom,
  navigation,
}, ref) {
  const t = useT();
  const isLauncherSurface = islandKey === "launcher";
  const resolvedIslandOpenTarget = useMemo(
    () => islandOpenTarget ?? defaultIslandOpenTarget(islandKey, islandSource),
    [islandKey, islandOpenTarget, islandSource],
  );
  useShellIslandShim({
    island: islandManagedExternally ? null : island,
    routeKey: islandKey,
    source: islandSource,
    priority: islandPriority,
    sticky: islandSticky,
    placement: islandPlacement,
    openTarget: resolvedIslandOpenTarget,
    suppressed: Boolean(customIsland) || islandManagedExternally,
  });

  const fallbackEscapeAction: QxShellAction = onBack
    ? { id: "escape", label: backLabel, kbd: "Esc", onClick: onBack }
    : {
        id: "escape",
        label: isLauncherSurface
          ? t("shell.hide", "Hide")
          : t("common.back", "Back"),
        kbd: "Esc",
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
  const hasLeading = Boolean(onBack || leading);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuAnchorPoint, setActionMenuAnchorPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextActionMenuRequest, setContextActionMenuRequest] =
    useState<QxShellActionMenuRequest | null>(null);
  const [actionIndex, setActionIndex] = useState(0);
  /** Raycast nested Action Panel stack (root → submenu → …). */
  const [menuStack, setMenuStack] = useState<
    Array<{
      title: string;
      actions: QxShellAction[];
      searchable?: boolean;
      searchPlaceholder?: string;
    }>
  >([]);
  const [menuQuery, setMenuQuery] = useState("");
  const [submenuLoading, setSubmenuLoading] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchGlowTimers = useRef<WeakMap<HTMLElement, ReturnType<typeof setTimeout>>>(new WeakMap());
  /** Focus target to restore when the Action menu closes (Raycast: Esc back to list). */
  const actionMenuFocusRestoreRef = useRef<HTMLElement | null>(null);
  const handledActionMenuRequestRef = useRef<number | null>(null);
  const handledContextActionMenuRequestRef = useRef<number | null>(null);
  const nextContextActionMenuRequestIdRef = useRef(0);
  const menuActions = useMemo(() => actions ?? [], [actions]);
  const primaryAction = useMemo(
    () => primaryActionId
      ? menuActions.find((action) => action.id === primaryActionId)
      : undefined,
    [menuActions, primaryActionId],
  );
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const issues = validateQxShellActions(menuActions, primaryActionId);
    if (issues.length > 0) {
      console.warn(`[QxShell:${islandKey}] invalid action protocol`, issues);
    }
  }, [islandKey, menuActions, primaryActionId]);
  const showActionMenu = menuActions.some((action) => action.id !== primaryActionId);
  const hasRightActions = Boolean(primaryAction || showActionMenu);
  const menuTitle = actionTitle ?? `${title} Actions`;
  const currentMenuLevel = menuStack[menuStack.length - 1];
  const rawLevelActions = currentMenuLevel?.actions ?? menuActions;
  const activeMenuActions = useMemo(() => {
    if (!currentMenuLevel?.searchable) return rawLevelActions;
    const q = menuQuery.trim().toLowerCase();
    if (!q) return rawLevelActions;
    return rawLevelActions.filter(
      (action) =>
        action.label.toLowerCase().includes(q)
        || (action.detail?.toLowerCase().includes(q) ?? false),
    );
  }, [currentMenuLevel?.searchable, menuQuery, rawLevelActions]);
  const activeMenuTitle = currentMenuLevel?.title ?? menuTitle;

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

  useEffect(() => {
    if (menuActions.length === 0) {
      setActionMenuOpen(false);
      setActionIndex(0);
      setMenuStack([]);
      setMenuQuery("");
      return;
    }
    // Keep root in sync while open (parent re-render); don't clobber nested drill-in.
    setMenuStack((stack) => {
      if (!actionMenuOpen) return stack;
      if (stack.length <= 1) {
        return [{ title: menuTitle, actions: menuActions }];
      }
      return stack;
    });
    setActionIndex((index) => Math.max(0, Math.min(index, Math.max(0, activeMenuActions.length - 1))));
  }, [menuActions, menuTitle, actionMenuOpen, activeMenuActions.length]);

  const captureActionMenuFocusRestore = useCallback(() => {
    const root = shellRef.current;
    const active = document.activeElement;
    if (root && active instanceof HTMLElement && root.contains(active)) {
      // Prefer the pre-menu focus (search field, list row, region).
      actionMenuFocusRestoreRef.current = active;
      return;
    }
    // Fallback: search input, then active region, then shell itself.
    const searchInput = root?.querySelector<HTMLElement>(
      ".qx-shell-search-slot input, .qx-shell-search-slot textarea, .qx-plugin-search",
    );
    if (searchInput) {
      actionMenuFocusRestoreRef.current = searchInput;
      return;
    }
    const region = activeRegionId
      ? root?.querySelector<HTMLElement>(`[data-qx-region="${CSS.escape(activeRegionId)}"]`)
      : null;
    actionMenuFocusRestoreRef.current = region ?? root;
  }, [activeRegionId]);

  const restoreActionMenuFocus = useCallback(() => {
    const target = actionMenuFocusRestoreRef.current;
    actionMenuFocusRestoreRef.current = null;
    if (!target) return;
    // Defer so Popover unmount / menu close does not steal focus back.
    requestAnimationFrame(() => {
      const root = shellRef.current;
      if (!root) return;
      const overlayOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
      );
      const active = document.activeElement;
      // An action may open a prompt/editor asynchronously. That new owner wins;
      // only restore when focus is still transient or stayed on the old target.
      if (
        overlayOpen
        || (
          active instanceof HTMLElement
          && active !== document.body
          && active !== target
          && isEditableTarget(active)
        )
      ) {
        return;
      }
      if (root.contains(target) && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
        return;
      }
      // Target unmounted (e.g. list re-rendered): land on search or shell.
      const searchInput = root.querySelector<HTMLElement>(
        ".qx-shell-search-slot input, .qx-shell-search-slot textarea, .qx-plugin-search",
      );
      (searchInput ?? root).focus({ preventScroll: true });
    });
  }, []);

  const openSubmenu = useCallback(async (action: QxShellAction) => {
    if (action.disabled || !actionHasSubmenu(action)) return;
    setSubmenuLoading(true);
    try {
      let children = action.children ?? [];
      if (action.loadChildren) {
        children = await action.loadChildren();
      }
      setMenuStack((stack) => [
        ...stack,
        {
          title: action.label,
          actions: children,
          searchable: action.searchable,
          searchPlaceholder: action.searchPlaceholder,
        },
      ]);
      setMenuQuery("");
      const firstEnabled = children.findIndex((item) => !item.disabled);
      setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    } catch {
      // Keep parent level if load fails.
    } finally {
      setSubmenuLoading(false);
    }
  }, []);

  const popMenuLevel = useCallback(() => {
    setMenuStack((stack) => {
      if (stack.length <= 1) return stack;
      return stack.slice(0, -1);
    });
    setMenuQuery("");
    setActionIndex(0);
    setSubmenuLoading(false);
  }, []);

  const runMenuAction = (action: QxShellAction) => {
    if (action.disabled) return;
    // Nested panel: drill in instead of running (Raycast ›).
    if (actionHasSubmenu(action)) {
      void openSubmenu(action);
      return;
    }
    setActionMenuOpen(false);
    setMenuStack([]);
    setMenuQuery("");
    // Keep list selection; only restore focus if the action does not navigate away.
    const focusTarget = actionMenuFocusRestoreRef.current;
    action.onClick?.();
    // Restore focus after action so list/search remains usable (unless focus moved).
    actionMenuFocusRestoreRef.current = focusTarget;
    restoreActionMenuFocus();
  };

  const findNextActionIndex = (startIndex: number, direction: 1 | -1): number => {
    const list = activeMenuActions;
    if (list.length === 0) return 0;
    for (let step = 1; step <= list.length; step += 1) {
      const index = (startIndex + step * direction + list.length) % list.length;
      if (!list[index]?.disabled) return index;
    }
    return Math.max(0, Math.min(startIndex, list.length - 1));
  };

  const findEdgeActionIndex = (direction: 1 | -1): number => {
    const list = activeMenuActions;
    if (list.length === 0) return 0;
    if (direction === 1) {
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (!list[index]?.disabled) return index;
      }
    } else {
      for (let index = 0; index < list.length; index += 1) {
        if (!list[index]?.disabled) return index;
      }
    }
    return 0;
  };

  const closeActionMenu = (options?: { restoreFocus?: boolean }) => {
    const restoreFocus = options?.restoreFocus ?? true;
    setActionMenuOpen(false);
    setMenuStack([]);
    setMenuQuery("");
    setSubmenuLoading(false);
    setActionMenuAnchorPoint(null);
    if (restoreFocus) restoreActionMenuFocus();
    else actionMenuFocusRestoreRef.current = null;
  };

  const openActionMenu = () => {
    if (actionMenuOpen) {
      // Toggle close (Cmd+K again / Actions button): animate out via controlled open.
      closeActionMenu({ restoreFocus: true });
      return;
    }
    captureActionMenuFocusRestore();
    setActionMenuAnchorPoint(null);
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setMenuStack([{ title: menuTitle, actions: menuActions }]);
    setMenuQuery("");
    setActionMenuOpen(true);
  };

  useEffect(() => {
    if (!actionMenuRequest || menuActions.length === 0) return;
    if (handledActionMenuRequestRef.current === actionMenuRequest.id) return;
    handledActionMenuRequestRef.current = actionMenuRequest.id;
    captureActionMenuFocusRestore();
    setActionMenuAnchorPoint({ x: actionMenuRequest.x, y: actionMenuRequest.y });
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setMenuStack([{ title: menuTitle, actions: menuActions }]);
    setMenuQuery("");
    setActionMenuOpen(true);
  }, [
    actionMenuRequest,
    captureActionMenuFocusRestore,
    menuActions,
    menuTitle,
  ]);

  useEffect(() => {
    if (!contextActionMenuRequest || menuActions.length === 0) return;
    if (handledContextActionMenuRequestRef.current === contextActionMenuRequest.id) return;
    handledContextActionMenuRequestRef.current = contextActionMenuRequest.id;
    captureActionMenuFocusRestore();
    setActionMenuAnchorPoint({
      x: contextActionMenuRequest.x,
      y: contextActionMenuRequest.y,
    });
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setMenuStack([{ title: menuTitle, actions: menuActions }]);
    setMenuQuery("");
    setActionMenuOpen(true);
  }, [
    captureActionMenuFocusRestore,
    contextActionMenuRequest,
    menuActions,
    menuTitle,
  ]);

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || menuActions.length === 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // Text editors and the shell's own overlays retain their native/context
    // semantics. The content area below is the shared item-action surface.
    if (
      target.closest(
        "input, textarea, select, [contenteditable='true'], .qx-actions-popover, .qx-action-panel, .qx-shell-topbar, .qx-shell-bottombar",
      )
    ) {
      return;
    }
    const row = target.closest<HTMLElement>("[data-qx-list-index]");
    const inContent = target.closest(".qx-shell-content");
    if (!inContent) return;

    if (row) {
      const index = Number.parseInt(row.getAttribute("data-qx-list-index") ?? "", 10);
      if (
        Number.isInteger(index)
        && index >= 0
        && index < (navigation?.count ?? Number.POSITIVE_INFINITY)
      ) {
        navigation?.onChange(index);
      }
    }

    event.preventDefault();
    const { clientX, clientY } = event;
    // Let the selection update commit before the action array is captured.
    window.requestAnimationFrame(() => {
      nextContextActionMenuRequestIdRef.current += 1;
      setContextActionMenuRequest({
        id: nextContextActionMenuRequestIdRef.current,
        x: clientX,
        y: clientY,
      });
    });
  };

  /** Radix/shadcn Popover dismiss (outside click) and controlled open sync. */
  const handleActionMenuOpenChange = (next: boolean) => {
    if (next) {
      if (actionMenuOpen) return;
      captureActionMenuFocusRestore();
      const firstEnabled = menuActions.findIndex((action) => !action.disabled);
      setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
      setMenuStack([{ title: menuTitle, actions: menuActions }]);
      setMenuQuery("");
      setActionMenuOpen(true);
      return;
    }
    closeActionMenu({ restoreFocus: true });
  };

  const isEnterOnlyShortcut = (kbd: string | undefined): boolean => {
    if (!kbd) return false;
    const normalized = kbd.trim().toLowerCase();
    return normalized === "enter" || normalized === "return" || normalized === "↵";
  };

  /** Resolve a module/shell action for the current key event (never host globals). */
  const findMatchingAction = (
    nativeEvent: KeyboardEvent,
    options?: { allowEnter?: boolean; menuOpen?: boolean },
  ): QxShellAction | undefined => {
    if (isReservedGlobalShortcutEvent(nativeEvent)) return undefined;
    if (isNativeEditingShortcut(nativeEvent)) return undefined;
    // Esc belongs only to escapeAction / useEscBack. Never bind actions with kbd "Esc"
    // (Chat Settings / Settings "Done" used to steal Esc via capture matching).
    if (nativeEvent.key === "Escape") return undefined;

    const allowEnter = options?.allowEnter ?? true;
    const menuOpen = options?.menuOpen ?? false;
    // While nested, menuKey/chords apply to the *current* level only; root
    // chords still match primary/secondary chrome when not in a submenu field.
    const levelActions = menuOpen ? activeMenuActions : menuActions;
    const candidates = menuOpen
      ? levelActions
      : [
          primaryAction,
          ...levelActions.filter((action) => action.id !== primaryAction?.id),
        ];

    return candidates.find((action) => {
      if (!action || action.disabled) return false;
      // Submenu items may only have onClick; parents may only have children.
      const runnable = Boolean(action.onClick) || actionHasSubmenu(action);
      if (!runnable) return false;

      // Raycast: single-letter menuKey only while the Actions panel is open.
      if (
        menuOpen
        && action.menuKey
        && action.menuKey.length === 1
        && action.menuKey.toLowerCase() !== " "
        && !nativeEvent.metaKey
        && !nativeEvent.ctrlKey
        && !nativeEvent.altKey
        && !nativeEvent.shiftKey
        && nativeEvent.key.toLowerCase() === action.menuKey.toLowerCase()
      ) {
        return true;
      }

      if (!action.kbd || isReservedGlobalShortcut(action.kbd)) return false;
      // Never treat Esc as a product action chord (UI_SPEC: left escape only).
      const kbdNorm = action.kbd.trim().toLowerCase();
      if (kbdNorm === "esc" || kbdNorm === "escape") return false;
      if (!allowEnter && isEnterOnlyShortcut(action.kbd)) return false;
      if (!matchesQxShortcut(nativeEvent, action.kbd)) return false;

      // Bare keys (including Enter) only when not typing in a field.
      if (!(nativeEvent.metaKey || nativeEvent.ctrlKey || nativeEvent.altKey || nativeEvent.shiftKey)) {
        return !shouldIgnoreBareShortcut(nativeEvent);
      }
      return true;
    });
  };

  /**
   * Raycast-style Action Panel: while open, capture navigation, Enter, bare
   * letters, and full action chords (⌘C / ⌘⌫ / …) before list/search handlers.
   * Nested menus: → / Enter drill in, ← / Esc pop level.
   * Never steals Alt+Space / Cmd+Space (launcher / Spotlight).
   */
  const handleActionMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): boolean => {
    if (!actionMenuOpen || menuActions.length === 0) return false;

    // Do not consume the Enter that confirms an IME candidate, even when the
    // action menu is open and would otherwise handle bare Enter as navigation.
    if (isImeCompositionEvent(event.nativeEvent)) return false;

    // Let host global chords pass through untouched.
    if (isReservedGlobalShortcutEvent(event.nativeEvent)) return false;

    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (matchesQxShortcut(event.nativeEvent, getQxShortcutPreset().actionMenu)) {
      consume();
      // Esc / Cmd+K close: back to the list selection & focus from before the menu.
      closeActionMenu({ restoreFocus: true });
      return true;
    }

    if (event.key === "Escape") {
      consume();
      // Raycast: Esc pops nested Action Panel first, then dismisses.
      if (menuStack.length > 1) {
        popMenuLevel();
        return true;
      }
      closeActionMenu({ restoreFocus: true });
      return true;
    }

    if (event.key === "ArrowLeft" && menuStack.length > 1) {
      consume();
      popMenuLevel();
      return true;
    }

    if (event.key === "ArrowRight") {
      const action = activeMenuActions[actionIndex];
      if (action && actionHasSubmenu(action) && !action.disabled) {
        consume();
        void openSubmenu(action);
        return true;
      }
    }

    if (event.key === "ArrowDown") {
      consume();
      setActionIndex((index) => findNextActionIndex(index, 1));
      return true;
    }

    if (event.key === "ArrowUp") {
      consume();
      setActionIndex((index) => findNextActionIndex(index, -1));
      return true;
    }

    if (event.key === "Home") {
      consume();
      setActionIndex(findEdgeActionIndex(-1));
      return true;
    }

    if (event.key === "End") {
      consume();
      setActionIndex(findEdgeActionIndex(1));
      return true;
    }

    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      consume();
      const action = activeMenuActions[actionIndex];
      if (action) runMenuAction(action);
      return true;
    }

    // Chords (⌘C, ⌘⌫) + menuKey single letters while the panel is open.
    // Bare Enter stays reserved for the highlighted row above.
    // When filtering a searchable submenu, ignore bare letters (typing).
    const typingInFilter =
      currentMenuLevel?.searchable
      && event.target instanceof HTMLElement
      && event.target.classList.contains("qx-actions-popover-search");
    if (!typingInFilter) {
      const chordAction = findMatchingAction(event.nativeEvent, {
        allowEnter: false,
        menuOpen: true,
      });
      if (chordAction) {
        consume();
        runMenuAction(chordAction);
        return true;
      }
    }

    // Keep the menu as a modal keyboard responder (Raycast Action Panel),
    // but never swallow Space with Alt/Cmd (already returned false above).
    // Allow typing in the nested filter field.
    if (typingInFilter) {
      return false;
    }
    if (event.key === " " || event.code === "Space") {
      return false;
    }

    consume();
    return true;
  };

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;

    if (isImeCompositionEvent(event.nativeEvent)) return;

    // Never intercept launcher / Spotlight chords inside the shell.
    if (isReservedGlobalShortcutEvent(event.nativeEvent)) return;

    if (handleActionMenuKeyDown(event)) return;

    // Match action chords in capture so search fields cannot eat ⌘⌫ / ⌘C / ⌘P.
    if (actionMenuOpen) return;

    if (matchesQxShortcut(event.nativeEvent, getQxShortcutPreset().actionMenu) && menuActions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu();
      return;
    }

    const matched = findMatchingAction(event.nativeEvent, { allowEnter: true, menuOpen: false });
    // Capture only modified chords (and non-Enter bare keys when not editing).
    // Enter paste stays on bubble so module onKeyDown can win for focus-at-cursor.
    if (matched && matched.kbd && !isEnterOnlyShortcut(matched.kbd)) {
      const hasMod = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
      if (hasMod || !shouldIgnoreBareShortcut(event.nativeEvent)) {
        event.preventDefault();
        event.stopPropagation();
        matched.onClick?.();
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;

    if (isImeCompositionEvent(event.nativeEvent)) return;

    if (isReservedGlobalShortcutEvent(event.nativeEvent)) return;

    // Bubble-phase safety net if capture was bypassed.
    if (handleActionMenuKeyDown(event)) return;

    if (matchesQxShortcut(event.nativeEvent, getQxShortcutPreset().actionMenu) && menuActions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu();
      return;
    }

    const nativeEvent = event.nativeEvent;
    const primaryEnterAction = event.key === "Enter"
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && primaryAction
      && !primaryAction.disabled
      && (primaryAction.onClick || actionHasSubmenu(primaryAction))
      ? primaryAction
      : undefined;
    // Outside native editors, Enter always executes the same stable action
    // shown in the Bottom Bar. Feature handlers cannot silently replace it.
    const targetInShellSearch = event.target instanceof Element
      && Boolean(event.target.closest(".qx-shell-search-slot"));
    if (
      primaryEnterAction
      && (!shouldIgnoreBareShortcut(nativeEvent) || targetInShellSearch)
    ) {
      event.preventDefault();
      event.stopPropagation();
      runMenuAction(primaryEnterAction);
      return;
    }

    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (handleNavigationKeyDown(event, navigation)) return;

    // Shell is the final keyboard fallback. Inner views, dialogs and search
    // fields get first refusal through normal bubbling; an otherwise
    // unhandled Esc always matches the visible bottom-bar action.
    if (event.key === "Escape" && visibleEscapeAction.onClick && !visibleEscapeAction.disabled) {
      event.preventDefault();
      event.stopPropagation();
      visibleEscapeAction.onClick();
      return;
    }

    // Bubble fallback for Enter / bare keys not handled in capture.
    const matchedAction = findMatchingAction(nativeEvent, { allowEnter: true, menuOpen: false });
    if (matchedAction) {
      event.preventDefault();
      event.stopPropagation();
      matchedAction.onClick?.();
    }
  };

  const handleInputCapture = (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("qx-plugin-search")) return;
    const wrap = target.closest<HTMLElement>(".qx-search-wrap");
    if (!wrap) return;
    wrap.classList.add("is-searching");
    const existingTimer = searchGlowTimers.current.get(wrap);
    if (existingTimer) clearTimeout(existingTimer);
    const nextTimer = setTimeout(() => {
      wrap.classList.remove("is-searching");
      searchGlowTimers.current.delete(wrap);
    }, 720);
    searchGlowTimers.current.set(wrap, nextTimer);
  };

  const startWindowResize = (
    event: React.PointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction).catch(() => {});
  };

  const startWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    // Direct topbar hits use Tauri's drag-region listener. Explicitly start a
    // drag from non-interactive title/wrapper descendants on every platform so
    // the useful move target is not limited to a few pixels of empty chrome.
    if (target === event.currentTarget) return;
    if (
      target?.closest(
        "button, a, input, textarea, select, [contenteditable='true'], [data-qx-no-window-drag]",
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div
      ref={assignShellRef}
      className={`qx-shell visual-${visual} ${IS_WINDOWS_HOST ? "is-windows-host" : ""} ${context ? "has-context" : ""} ${overlayBottom ? "qx-shell-overlay-bottom" : ""} ${className}`}
      style={style}
      aria-label={title}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      onInputCapture={handleInputCapture}
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

      <div
        className={`qx-shell-topbar${hasLeading ? "" : " no-leading"}`}
        data-tauri-drag-region
        onPointerDown={startWindowDrag}
      >
        {IS_WINDOWS_HOST ? (
          <div
            className="qx-shell-window-drag-handle"
            data-qx-window-drag-handle
            aria-hidden="true"
          />
        ) : null}
        {onBack ? (
          <button
            className="qx-shell-back"
            onClick={onBack}
            title={backLabel}
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        ) : (
          leading
        )}
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

      <div className="qx-shell-main">
        <main className="qx-shell-content">{children}</main>
        {context && <aside className="qx-shell-context">{context}</aside>}
      </div>

      <div className="qx-shell-bottombar">
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
        {/* Ordinary island content always resolves through the session store.
            Only classified custom HUDs may suppress the docked winner. */}
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
                  triggerAttrs={{ [QX_ACTION_MENU_TRIGGER_ATTR]: true }}
                />
              ) : null}
            </>
          ) : null}
          <ShellActionButton action={visibleEscapeAction} variant="escape" />
        </div>
      </div>
      {/* Keep mounted so Radix/shadcn can play open/close animations. */}
      {menuActions.length > 0 && (
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
            currentMenuLevel?.searchPlaceholder ?? "Filter…"
          }
          loading={submenuLoading}
          anchorPoint={actionMenuAnchorPoint}
        />
      )}
    </div>
  );
});

export default QxShell;
