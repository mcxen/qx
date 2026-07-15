import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { type BottomIslandContent } from "./QxBottomIsland";
import ShellActionButton, { type QxShellAction } from "./ShellActionButton";
import ShellActionMenu, { QX_ACTION_MENU_TRIGGER_ATTR } from "./ShellActionMenu";
import {
  useQxShellNavigation,
  type QxShellNavigation,
} from "../hooks/useQxShellNavigation";
import {
  getQxShortcutPreset,
  isImeCompositionEvent,
  isNativeEditingShortcut,
  isReservedGlobalShortcut,
  isReservedGlobalShortcutEvent,
  matchesQxShortcut,
  shouldIgnoreBareShortcut,
} from "../utils/keyboard";
import QxBottomIsland from "./QxBottomIsland";
import QxIslandDockSlot from "../island/surface/QxIslandDockSlot";
import { useShellIslandShim } from "../island/compat/useShellIslandShim";
import type { IslandPriority, IslandSource } from "../island/types";

export type { BottomIslandContent } from "./QxBottomIsland";
export type { QxShellAction } from "./ShellActionButton";

interface QxShellProps {
  title: string;
  visual?: "solid" | "elevated" | "glass";
  search?: ReactNode;
  leading?: ReactNode;
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
   * Shim session key → module.${islandKey}.shell
   * Defaults to a slug of title.
   */
  islandKey?: string;
  islandSource?: IslandSource;
  islandPriority?: IslandPriority;
  islandSticky?: boolean;
  /**
   * When true, do not write island prop into the store (caller owns session,
   * e.g. Launcher home/search via islandHost).
   */
  islandManagedExternally?: boolean;
  escapeAction?: QxShellAction;
  primaryAction?: QxShellAction;
  secondaryAction?: QxShellAction;
  actions?: QxShellAction[];
  actionTitle?: string;
  onBack?: () => void;
  backLabel?: string;
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
  trailing,
  children,
  context,
  island,
  customIsland,
  islandKey,
  islandSource = "module",
  islandPriority = "location",
  islandSticky = false,
  islandManagedExternally = false,
  escapeAction,
  primaryAction,
  secondaryAction,
  actions,
  actionTitle,
  onBack,
  backLabel = "Back",
  className = "",
  style,
  onKeyDown,
  overlayBottom,
  navigation,
}, ref) {
  const routeKey =
    islandKey ??
    (title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "active");

  useShellIslandShim({
    island: islandManagedExternally ? null : island,
    routeKey,
    source: islandSource,
    priority: islandPriority,
    sticky: islandSticky,
    suppressed: Boolean(customIsland) || islandManagedExternally,
  });

  const fallbackEscapeAction: QxShellAction = onBack
    ? { label: backLabel, kbd: "Esc", onClick: onBack }
    : { label: "Esc", kbd: "Esc" };
  const leftAction = escapeAction ?? fallbackEscapeAction;
  const hasLeading = Boolean(onBack || leading);
  const visiblePrimaryAction = primaryAction?.disabled ? undefined : primaryAction;
  const visibleSecondaryAction = secondaryAction?.disabled ? undefined : secondaryAction;
  const hasRightActions = Boolean(visiblePrimaryAction || visibleSecondaryAction);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchGlowTimers = useRef<WeakMap<HTMLElement, ReturnType<typeof setTimeout>>>(new WeakMap());
  /** Focus target to restore when the Action menu closes (Raycast: Esc back to list). */
  const actionMenuFocusRestoreRef = useRef<HTMLElement | null>(null);
  const menuActions = useMemo(() => actions ?? [], [actions]);
  const menuTitle = actionTitle ?? `${title} Actions`;

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
      return;
    }
    setActionIndex((index) => Math.max(0, Math.min(index, menuActions.length - 1)));
  }, [menuActions.length]);

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

  const runMenuAction = (action: QxShellAction) => {
    if (action.disabled) return;
    setActionMenuOpen(false);
    // Keep list selection; only restore focus if the action does not navigate away.
    const focusTarget = actionMenuFocusRestoreRef.current;
    action.onClick?.();
    // Restore focus after action so list/search remains usable (unless focus moved).
    actionMenuFocusRestoreRef.current = focusTarget;
    restoreActionMenuFocus();
  };

  const findNextActionIndex = (startIndex: number, direction: 1 | -1): number => {
    if (menuActions.length === 0) return 0;
    for (let step = 1; step <= menuActions.length; step += 1) {
      const index = (startIndex + step * direction + menuActions.length) % menuActions.length;
      if (!menuActions[index]?.disabled) return index;
    }
    return Math.max(0, Math.min(startIndex, menuActions.length - 1));
  };

  const findEdgeActionIndex = (direction: 1 | -1): number => {
    if (menuActions.length === 0) return 0;
    if (direction === 1) {
      for (let index = menuActions.length - 1; index >= 0; index -= 1) {
        if (!menuActions[index]?.disabled) return index;
      }
    } else {
      for (let index = 0; index < menuActions.length; index += 1) {
        if (!menuActions[index]?.disabled) return index;
      }
    }
    return 0;
  };

  const closeActionMenu = (options?: { restoreFocus?: boolean }) => {
    const restoreFocus = options?.restoreFocus ?? true;
    setActionMenuOpen(false);
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
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setActionMenuOpen(true);
  };

  /** Radix/shadcn Popover dismiss (outside click) and controlled open sync. */
  const handleActionMenuOpenChange = (next: boolean) => {
    if (next) {
      if (actionMenuOpen) return;
      captureActionMenuFocusRestore();
      const firstEnabled = menuActions.findIndex((action) => !action.disabled);
      setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
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
    const candidates = [...menuActions, visiblePrimaryAction, visibleSecondaryAction];

    return candidates.find((action) => {
      if (!action || action.disabled || !action.onClick) return false;

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
      // Raycast: Esc dismisses Action Panel and returns to the prior list context.
      closeActionMenu({ restoreFocus: true });
      return true;
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
      const action = menuActions[actionIndex];
      if (action) runMenuAction(action);
      return true;
    }

    // Chords (⌘C, ⌘⌫) + menuKey single letters while the panel is open.
    // Bare Enter stays reserved for the highlighted row above.
    const chordAction = findMatchingAction(event.nativeEvent, {
      allowEnter: false,
      menuOpen: true,
    });
    if (chordAction) {
      consume();
      runMenuAction(chordAction);
      return true;
    }

    // Keep the menu as a modal keyboard responder (Raycast Action Panel),
    // but never swallow Space with Alt/Cmd (already returned false above).
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

    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const nativeEvent = event.nativeEvent;
    if (handleNavigationKeyDown(event, navigation)) return;

    // Shell is the final keyboard fallback. Inner views, dialogs and search
    // fields get first refusal through normal bubbling; an otherwise
    // unhandled Esc always matches the visible bottom-bar action.
    if (event.key === "Escape" && leftAction.onClick && !leftAction.disabled) {
      event.preventDefault();
      event.stopPropagation();
      leftAction.onClick();
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

  return (
    <div
      ref={assignShellRef}
      className={`qx-shell visual-${visual} ${context ? "has-context" : ""} ${overlayBottom ? "qx-shell-overlay-bottom" : ""} ${className}`}
      style={style}
      aria-label={title}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onInputCapture={handleInputCapture}
      onFocusCapture={handleRegionFocusCapture}
      onPointerDownCapture={handleRegionPointerCapture}
      tabIndex={0}
    >
      <div className="qx-shell-drag-edge edge-top" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-right" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-bottom" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-left" data-tauri-drag-region aria-hidden="true" />

      <div
        className={`qx-shell-topbar${hasLeading ? "" : " no-leading"}`}
        data-tauri-drag-region
      >
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
        {trailing && <div className="qx-shell-trailing">{trailing}</div>}
      </div>

      <div className="qx-shell-main">
        <main className="qx-shell-content">{children}</main>
        {context && <aside className="qx-shell-context">{context}</aside>}
      </div>

      <div className="qx-shell-bottombar">
        <div className="qx-shell-left">
          <ShellActionButton action={leftAction} variant="escape" />
        </div>
        {/*
          Docked island render order (reliable over store-only):
          1) classified customIsland exception (recorder transport, home custom modes)
          2) legacy island prop (shell status) — always paints even if session store fails
          3) session store winner via QxIslandDockSlot
        */}
        {customIsland ? (
          customIsland
        ) : island ? (
          <QxBottomIsland content={island} />
        ) : (
          <QxIslandDockSlot />
        )}
        {hasRightActions ? (
          <div className="qx-shell-actions">
            <ShellActionButton action={visiblePrimaryAction} />
            <ShellActionButton
              action={
                visibleSecondaryAction && menuActions.length > 0 && !visibleSecondaryAction.onClick
                  ? {
                      ...visibleSecondaryAction,
                      onClick: () => {
                        openActionMenu();
                      },
                    }
                  : visibleSecondaryAction
              }
              triggerAttrs={
                visibleSecondaryAction && menuActions.length > 0 && !visibleSecondaryAction.onClick
                  ? { [QX_ACTION_MENU_TRIGGER_ATTR]: true }
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="qx-shell-actions is-empty" aria-hidden="true" />
        )}
      </div>
      {/* Keep mounted so Radix/shadcn can play open/close animations. */}
      {menuActions.length > 0 && (
        <ShellActionMenu
          open={actionMenuOpen}
          onOpenChange={handleActionMenuOpenChange}
          title={menuTitle}
          actions={menuActions}
          activeIndex={actionIndex}
          onHover={setActionIndex}
          onRun={runMenuAction}
        />
      )}
    </div>
  );
});

export default QxShell;
