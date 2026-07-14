import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import QxBottomIsland, { type BottomIslandContent } from "./QxBottomIsland";
import ShellActionButton, { type QxShellAction } from "./ShellActionButton";
import ShellActionMenu from "./ShellActionMenu";
import {
  getQxShortcutPreset,
  isNativeEditingShortcut,
  matchesQxShortcut,
  shouldIgnoreBareShortcut,
} from "../utils/keyboard";

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
  customIsland?: ReactNode;
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
  navigation?: {
    index: number;
    count: number;
    onChange: (index: number) => void;
    onOpen?: () => void;
    onClose?: () => void;
    pageSize?: number;
  };
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
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchGlowTimers = useRef<WeakMap<HTMLElement, ReturnType<typeof setTimeout>>>(new WeakMap());
  const menuActions = useMemo(() => actions ?? [], [actions]);
  const menuTitle = actionTitle ?? `${title} Actions`;

  const assignShellRef = useCallback((element: HTMLDivElement | null) => {
    shellRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }, [ref]);

  const getKeyboardRegions = useCallback((): HTMLElement[] => {
    const root = shellRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-qx-region]"))
      .filter((region) =>
        region.getAttribute("aria-hidden") !== "true"
        && !region.hasAttribute("hidden")
        && region.getClientRects().length > 0
      );
  }, []);

  const activateRegion = useCallback((region: HTMLElement, focus = true) => {
    const id = region.dataset.qxRegion;
    if (!id) return;
    setActiveRegionId(id);
    if (focus) region.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const regions = getKeyboardRegions();
    if (regions.length === 0) {
      setActiveRegionId(null);
      return;
    }
    const retained = activeRegionId
      ? regions.find((region) => region.dataset.qxRegion === activeRegionId)
      : null;
    if (!retained) {
      const preferred = regions.find((region) => region.dataset.qxRegionInitial === "true") ?? regions[0];
      setActiveRegionId(preferred.dataset.qxRegion ?? null);
    }
  }, [activeRegionId, children, context, getKeyboardRegions]);

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    if (activeRegionId) root.dataset.qxActiveRegion = activeRegionId;
    else delete root.dataset.qxActiveRegion;
    for (const region of getKeyboardRegions()) {
      region.classList.toggle("is-qx-region-active", region.dataset.qxRegion === activeRegionId);
    }
  }, [activeRegionId, getKeyboardRegions]);

  useEffect(() => {
    if (menuActions.length === 0) {
      setActionMenuOpen(false);
      setActionIndex(0);
      return;
    }
    setActionIndex((index) => Math.max(0, Math.min(index, menuActions.length - 1)));
  }, [menuActions.length]);

  const runMenuAction = (action: QxShellAction) => {
    if (action.disabled) return;
    setActionMenuOpen(false);
    action.onClick?.();
  };

  const findNextActionIndex = (startIndex: number, direction: 1 | -1): number => {
    if (menuActions.length === 0) return 0;
    for (let step = 1; step <= menuActions.length; step += 1) {
      const index = (startIndex + step * direction + menuActions.length) % menuActions.length;
      if (!menuActions[index]?.disabled) return index;
    }
    return Math.max(0, Math.min(startIndex, menuActions.length - 1));
  };

  const openActionMenu = () => {
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setActionMenuOpen((open) => !open);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;

    if (actionMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActionMenuOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => findNextActionIndex(index, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => findNextActionIndex(index, -1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const action = menuActions[actionIndex];
        if (action) runMenuAction(action);
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const action = menuActions.find(
          (item) => item.kbd?.length === 1 && item.kbd.toLowerCase() === event.key.toLowerCase(),
        );
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          runMenuAction(action);
        }
        return;
      }
      return;
    }

    if (matchesQxShortcut(event.nativeEvent, getQxShortcutPreset().actionMenu) && menuActions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu();
      return;
    }

    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const nativeEvent = event.nativeEvent;
    const editable = shouldIgnoreBareShortcut(nativeEvent);
    const isBareRegionKey = !editable && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (isBareRegionKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const regions = getKeyboardRegions();
      if (regions.length > 1) {
        const targetRegion = event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-qx-region]")
          : null;
        const currentIndex = Math.max(0, regions.findIndex((region) =>
          region === targetRegion || region.dataset.qxRegion === activeRegionId
        ));
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(regions.length - 1, currentIndex + delta));
        event.preventDefault();
        event.stopPropagation();
        activateRegion(regions[nextIndex]);
        return;
      }
    }

    if (navigation && navigation.count > 0) {
      const last = navigation.count - 1;
      const page = Math.max(1, navigation.pageSize ?? 8);
      let next: number | null = null;
      if (event.key === "ArrowDown") next = Math.min(last, navigation.index + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, navigation.index - 1);
      else if (event.key === "PageDown") next = Math.min(last, navigation.index + page);
      else if (event.key === "PageUp") next = Math.max(0, navigation.index - page);
      else if (!editable && event.key === "Home") next = 0;
      else if (!editable && event.key === "End") next = last;
      else if (!editable && event.key === "ArrowRight" && navigation.onOpen) navigation.onOpen();
      else if (!editable && event.key === "ArrowLeft" && navigation.onClose) navigation.onClose();
      if (next !== null || (!editable && (event.key === "ArrowRight" || event.key === "ArrowLeft"))) {
        event.preventDefault();
        event.stopPropagation();
        if (next !== null) navigation.onChange(next);
        return;
      }
    }

    if (!editable && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const targetRegion = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-qx-region]")
        : null;
      const activeRegion = targetRegion
        ?? getKeyboardRegions().find((region) => region.dataset.qxRegion === activeRegionId)
        ?? null;
      const scrollTarget = activeRegion?.matches("[data-qx-region-scroll]")
        ? activeRegion
        : activeRegion?.querySelector<HTMLElement>("[data-qx-region-scroll]") ?? null;
      if (scrollTarget && scrollTarget.scrollHeight > scrollTarget.clientHeight + 1) {
        const page = Math.max(48, Math.round(scrollTarget.clientHeight * 0.82));
        let top: number | null = null;
        if (event.key === "ArrowDown") top = scrollTarget.scrollTop + 56;
        else if (event.key === "ArrowUp") top = scrollTarget.scrollTop - 56;
        else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) top = scrollTarget.scrollTop + page;
        else if (event.key === "PageUp" || (event.key === " " && event.shiftKey)) top = scrollTarget.scrollTop - page;
        else if (event.key === "Home") top = 0;
        else if (event.key === "End") top = scrollTarget.scrollHeight;
        if (top !== null) {
          event.preventDefault();
          event.stopPropagation();
          scrollTarget.scrollTo({ top, behavior: "auto" });
          return;
        }
      }
    }

    // Shell is the final keyboard fallback. Inner views, dialogs and search
    // fields get first refusal through normal bubbling; an otherwise
    // unhandled Esc always matches the visible bottom-bar action.
    if (event.key === "Escape" && leftAction.onClick && !leftAction.disabled) {
      event.preventDefault();
      event.stopPropagation();
      leftAction.onClick();
      return;
    }

    const candidates = [visiblePrimaryAction, visibleSecondaryAction, ...menuActions];
    const matchedAction = candidates.find((action) => {
      if (!action || action.disabled || !matchesQxShortcut(nativeEvent, action.kbd)) return false;
      if (isNativeEditingShortcut(nativeEvent)) return false;
      return nativeEvent.metaKey || nativeEvent.ctrlKey || nativeEvent.altKey || !shouldIgnoreBareShortcut(nativeEvent);
    });
    if (matchedAction) {
      event.preventDefault();
      event.stopPropagation();
      runMenuAction(matchedAction);
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

  const handleRegionFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const region = event.target.closest<HTMLElement>("[data-qx-region]");
    if (region && shellRef.current?.contains(region)) activateRegion(region, false);
  };

  const handleRegionPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const region = event.target.closest<HTMLElement>("[data-qx-region]");
    if (region && shellRef.current?.contains(region)) activateRegion(region, false);
  };

  return (
    <div
      ref={assignShellRef}
      className={`qx-shell visual-${visual} ${context ? "has-context" : ""} ${overlayBottom ? "qx-shell-overlay-bottom" : ""} ${className}`}
      style={style}
      aria-label={title}
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
        {customIsland ?? <QxBottomIsland content={island} />}
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
            />
          </div>
        ) : (
          <div className="qx-shell-actions is-empty" aria-hidden="true" />
        )}
      </div>
      {actionMenuOpen && menuActions.length > 0 && (
        <ShellActionMenu
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
