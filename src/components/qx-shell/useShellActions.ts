import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { QxShellAction, QxShellActionMenuRequest } from "./actionProtocol";
import { validateQxShellActions, actionHasSubmenu } from "./actionProtocol";
import type { QxShellNavigation } from "../../hooks/useQxShellNavigation";
import { getQxShortcutPreset, isImeCompositionEvent, shouldDeferEscapeForIme, isEditableTarget, isNativeEditingShortcut, isReservedGlobalShortcut, isReservedGlobalShortcutEvent, matchesQxShortcut, shouldIgnoreBareShortcut } from "../../utils/keyboard";
import { tryCloseRecentSwitcher } from "../../island/recents/recentViews";
import { useT } from "../../i18n";
import { createActionExecution, createMenuGeneration } from "./actionExecution";
import { islandHost } from "../../island/session/hostApi";

interface ShellActionsOptions {
  actions?: QxShellAction[];
  primaryActionId?: string;
  actionTitle?: string;
  title: string;
  islandKey: string;
  actionMenuRequest?: QxShellActionMenuRequest | null;
  shellRef: RefObject<HTMLDivElement | null>;
  activeRegionId: string | null;
  navigation?: QxShellNavigation;
  handleNavigationKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, navigation?: QxShellNavigation) => boolean;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  visibleEscapeAction: QxShellAction;
}

export function useShellActions({
  actions, primaryActionId, actionTitle, title, islandKey, actionMenuRequest,
  shellRef, activeRegionId, navigation, handleNavigationKeyDown, onKeyDown,
  visibleEscapeAction,
}: ShellActionsOptions) {
  const t = useT();
  const execution = useMemo(createActionExecution, [islandKey]);
  const generation = useMemo(createMenuGeneration, [islandKey]);
  const [, refreshPending] = useState(0);
  const changed = useCallback(() => refreshPending((value) => value + 1), []);
  const actionErrorId = `shell.action.error.${islandKey}`;
  useEffect(() => () => {
    generation.invalidate();
    execution.invalidate();
    islandHost.dismiss(actionErrorId);
  }, [execution, generation, actionErrorId]);
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
      root?: boolean;
    }>
  >([]);
  const [menuQuery, setMenuQuery] = useState("");
  const [submenuLoading, setSubmenuLoading] = useState(false);
  const latestRun = useRef<(action: QxShellAction) => void>(() => {});
  const submenuRequest = useRef<{ id: string; isCurrent: () => boolean } | null>(null);
  useEffect(() => { generation.invalidate(); setSubmenuLoading(false); }, [actions, generation]);
  useEffect(() => {
    setActionMenuOpen(false);
    setMenuStack([]);
    setMenuQuery("");
    setSubmenuLoading(false);
  }, [islandKey]);
  /** Focus target to restore when the Action menu closes (Raycast: Esc back to list). */
  const actionMenuFocusRestoreRef = useRef<HTMLElement | null>(null);
  const focusRestoreFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusRestoreFrame.current), []);
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
  const showActionMenu = menuActions.length > 0;
  const hasRightActions = Boolean(primaryAction || showActionMenu);
  const menuTitle = actionTitle ?? title;
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

  useEffect(() => {
    // Keep root in sync while open (parent re-render); don't clobber nested drill-in.
    setMenuStack((stack) => {
      if (!actionMenuOpen) return stack;
      if (stack.length === 1 && stack[0].root) {
        return [{ title: menuTitle, actions: menuActions, root: true }];
      }
      return stack;
    });
    setActionIndex((index) => Math.max(0, Math.min(index, Math.max(0, activeMenuActions.length - 1))));
  }, [menuActions, menuTitle, actionMenuOpen, activeMenuActions.length]);

  const captureActionMenuFocusRestore = useCallback(() => {
    cancelAnimationFrame(focusRestoreFrame.current);
    focusRestoreFrame.current = 0;
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
    cancelAnimationFrame(focusRestoreFrame.current);
    focusRestoreFrame.current = requestAnimationFrame(() => {
      focusRestoreFrame.current = 0;
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

  const reportFailure = (action: QxShellAction, error: unknown) => {
    islandHost.show({
      id: actionErrorId, priority: "error", source: "module", placement: "docked-or-float",
      content: { primary: action.label, secondary: String(error instanceof Error ? error.message : error), tone: "danger",
        action: { id: "retry", label: t("common.retry", "Retry") } },
      actions: { retry: () => { islandHost.dismiss(actionErrorId); latestRun.current(action); } },
    });
  };

  const openSubmenu = async (action: QxShellAction) => {
    if (action.disabled || !actionHasSubmenu(action)) return;
    if (submenuRequest.current?.id === action.id && submenuRequest.current.isCurrent()) return;
    if (!actionMenuOpen) beginActionMenu();
    const isCurrent = generation.next();
    submenuRequest.current = { id: action.id, isCurrent };
    setSubmenuLoading(true);
    try {
      let children = action.children ?? [];
      if (action.loadChildren) {
        children = await action.loadChildren();
      }
      if (!isCurrent()) return;
      const issues = validateQxShellActions(children);
      if (issues.length) throw new Error(issues.join("; "));
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
    } catch (error) {
      if (isCurrent()) reportFailure(action, error);
    } finally {
      if (isCurrent()) { submenuRequest.current = null; setSubmenuLoading(false); }
    }
  };

  const popMenuLevel = useCallback(() => {
    generation.invalidate();
    setMenuStack((stack) => {
      if (stack.length <= 1) return stack;
      return stack.slice(0, -1);
    });
    setMenuQuery("");
    setActionIndex(0);
    setSubmenuLoading(false);
  }, [generation]);

  const runMenuAction = (action: QxShellAction) => {
    if (action.disabled || execution.isPending(action.id)) return;
    // Nested panel: drill in instead of running (Raycast ›).
    if (actionHasSubmenu(action)) {
      void openSubmenu(action);
      return;
    }
    generation.invalidate();
    setActionMenuOpen(false);
    setMenuStack([]);
    setMenuQuery("");
    // Keep list selection; only restore focus if the action does not navigate away.
    const focusTarget = actionMenuFocusRestoreRef.current;
    void execution.run(action.id, action, () => action.onClick?.(), changed,
      (error) => reportFailure(action, error));
    // Restore focus after action so list/search remains usable (unless focus moved).
    actionMenuFocusRestoreRef.current = focusTarget;
    restoreActionMenuFocus();
  };
  latestRun.current = runMenuAction;

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
    generation.invalidate();
    const restoreFocus = options?.restoreFocus ?? true;
    setActionMenuOpen(false);
    setMenuStack([]);
    setMenuQuery("");
    setSubmenuLoading(false);
    setActionMenuAnchorPoint(null);
    if (restoreFocus) restoreActionMenuFocus();
    else actionMenuFocusRestoreRef.current = null;
  };

  const beginActionMenu = (point: { x: number; y: number } | null = null) => {
    generation.invalidate();
    captureActionMenuFocusRestore();
    setActionMenuAnchorPoint(point);
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setMenuStack(menuActions.length ? [{ title: menuTitle, actions: menuActions, root: true }] : []);
    setMenuQuery("");
    setSubmenuLoading(false);
    setActionMenuOpen(true);
  };

  const openActionMenu = () => {
    if (actionMenuOpen) {
      // Toggle close (Cmd+K again / Actions button): animate out via controlled open.
      closeActionMenu({ restoreFocus: true });
      return;
    }
    beginActionMenu();
  };

  useEffect(() => {
    if (!actionMenuRequest || menuActions.length === 0) return;
    if (handledActionMenuRequestRef.current === actionMenuRequest.id) return;
    handledActionMenuRequestRef.current = actionMenuRequest.id;
    beginActionMenu(actionMenuRequest);
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
    beginActionMenu(contextActionMenuRequest);
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
      beginActionMenu();
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
    if (!actionMenuOpen) return false;

    // Do not consume the Enter that confirms an IME candidate, even when the
    // action menu is open and would otherwise handle bare Enter as navigation.
    if (isImeCompositionEvent(event.nativeEvent)) return false;

    // Let host global chords pass through untouched.
    if (isReservedGlobalShortcutEvent(event.nativeEvent)) return false;
    if (isNativeEditingShortcut(event.nativeEvent)) return false;
    const editing = isEditableTarget(event.target);
    if (editing && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return false;
    if (event.key === "Tab") return false;

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
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="dialog"], [role="listbox"], [role="menu"]') && !target.closest('.qx-actions-popover')) return;

    if (shouldDeferEscapeForIme(event.nativeEvent)) return;
    if (event.key !== "Escape" && isImeCompositionEvent(event.nativeEvent)) return;

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
        runMenuAction(matched);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="dialog"], [role="listbox"], [role="menu"]') && !target.closest('.qx-actions-popover')) return;

    // Esc must still clear/hide after Chinese IME; only defer while composing.
    if (shouldDeferEscapeForIme(event.nativeEvent)) return;
    if (event.key !== "Escape" && isImeCompositionEvent(event.nativeEvent)) return;

    if (isReservedGlobalShortcutEvent(event.nativeEvent)) return;

    // Bubble-phase safety net if capture was bypassed.
    if (handleActionMenuKeyDown(event)) return;
    if (actionMenuOpen) return;

    if (matchesQxShortcut(event.nativeEvent, getQxShortcutPreset().actionMenu) && menuActions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu();
      return;
    }

    if (event.key === "Escape" && tryCloseRecentSwitcher()) {
      event.preventDefault();
      event.stopPropagation();
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
      runMenuAction(visibleEscapeAction);
      return;
    }

    // Bubble fallback for Enter / bare keys not handled in capture.
    const matchedAction = findMatchingAction(nativeEvent, { allowEnter: true, menuOpen: false });
    if (matchedAction) {
      event.preventDefault();
      event.stopPropagation();
      runMenuAction(matchedAction);
    }
  };

  return {
    actionExecution: {
      run: runMenuAction,
      isPending: (action: QxShellAction) => execution.isPending(action.id)
        || (submenuLoading && submenuRequest.current?.id === action.id && submenuRequest.current.isCurrent()),
    },
    primaryAction, showActionMenu, hasRightActions, menuActions, actionMenuOpen,
    handleActionMenuOpenChange, activeMenuTitle, activeMenuActions, actionIndex,
    setActionIndex, runMenuAction, menuStack, popMenuLevel, currentMenuLevel,
    menuQuery, setMenuQuery, submenuLoading, actionMenuAnchorPoint, openActionMenu,
    handleKeyDownCapture, handleKeyDown, handleContextMenu,
  };
}
