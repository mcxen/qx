import { useCallback, useEffect, useRef } from "react";
import { useStore } from "./store";
import { requestPanelKeyWindow } from "./hooks/usePanelKeyWindow";
import { useT } from "./i18n";

/** Fired when the floating panel is shown / returns to launcher search. */
export const FOCUS_LAUNCHER_SEARCH_EVENT = "qx:focus-launcher-search";

export function requestLauncherSearchFocus(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_LAUNCHER_SEARCH_EVENT));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
    || target.getAttribute("role") === "textbox";
}

function hasOpenKeyboardOverlay(): boolean {
  return Boolean(document.querySelector(
    '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
  ));
}

export default function SearchBar({
  onKeyDown,
  embedded = false,
}: {
  onKeyDown: (e: React.KeyboardEvent) => void;
  embedded?: boolean;
}) {
  const t = useT();
  const query = useStore((state) => state.query);
  const setQuery = useStore((state) => state.setQuery);
  const setSelectedIndex = useStore((state) => state.setSelectedIndex);
  const visible = useStore((state) => state.visible);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const focusRetryRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Key window first so typing lands in the webview (macOS NSPanel).
    // requestPanelKeyWindow is debounced — safe to call from multiple paths.
    requestPanelKeyWindow();
    el.focus({ preventScroll: true });
  }, []);

  const focusInputAfterPanelActivation = useCallback(() => {
    focusInput();
    if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
    if (focusRetryRef.current != null) window.clearTimeout(focusRetryRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      focusInput();
    });
    // AppKit can report the panel focused before its WebView has restored first
    // responder. One bounded retry keeps summon deterministic without polling.
    focusRetryRef.current = window.setTimeout(() => {
      focusRetryRef.current = null;
      if (hasOpenKeyboardOverlay()) return;
      const active = document.activeElement;
      if (active !== inputRef.current && isEditableTarget(active)) return;
      focusInput();
    }, 120);
  }, [focusInput]);

  // Mount (including remount when returning to launcher from another tab).
  useEffect(() => {
    focusInputAfterPanelActivation();
  }, [focusInputAfterPanelActivation]);

  // Re-show via Option+Space: component stays mounted, so remount effect does not run.
  useEffect(() => {
    if (!visible) return;
    focusInputAfterPanelActivation();
  }, [visible, focusInputAfterPanelActivation]);

  useEffect(() => {
    const onRequest = () => focusInputAfterPanelActivation();
    window.addEventListener(FOCUS_LAUNCHER_SEARCH_EVENT, onRequest);
    return () => {
      window.removeEventListener(FOCUS_LAUNCHER_SEARCH_EVENT, onRequest);
      if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
      if (focusRetryRef.current != null) window.clearTimeout(focusRetryRef.current);
    };
  }, [focusInputAfterPanelActivation]);

  // Launcher typing owns focus unless the user is editing another field or an
  // interactive overlay is open. This also preserves the first character when
  // a button or non-focusable result briefly held keyboard focus.
  useEffect(() => {
    if (!visible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.isComposing
        || event.key === "Process"
        || event.key === "Dead"
        || event.keyCode === 229
      ) {
        if (!isEditableTarget(document.activeElement) && !hasOpenKeyboardOverlay()) focusInput();
        return;
      }
      if (document.activeElement === input || isEditableTarget(document.activeElement)) return;
      if (hasOpenKeyboardOverlay()) return;
      const isPrintable = Array.from(event.key).length === 1;
      if (!(isPrintable || event.key === "Backspace" || event.key === "Delete")) return;

      event.preventDefault();
      event.stopPropagation();
      focusInput();
      const value = input.value;
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? start;
      let next = value;
      let caret = start;
      if (isPrintable) {
        next = `${value.slice(0, start)}${event.key}${value.slice(end)}`;
        caret = start + event.key.length;
      } else if (event.key === "Backspace" && start === end && start > 0) {
        next = `${value.slice(0, start - 1)}${value.slice(end)}`;
        caret = start - 1;
      } else if (event.key === "Delete" && start === end) {
        next = `${value.slice(0, start)}${value.slice(start + 1)}`;
      } else {
        next = `${value.slice(0, start)}${value.slice(end)}`;
      }
      setQuery(next);
      setSelectedIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(caret, caret));
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [focusInput, setQuery, setSelectedIndex, visible]);

  const input = (
    <div className="qx-search-wrap">
      <span className="qx-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        data-qx-primary-search="true"
        autoFocus
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIndex(0);
        }}
        onFocus={requestPanelKeyWindow}
        onKeyDown={onKeyDown}
        placeholder={t("launcher.placeholder", "Search for apps and commands...")}
        className="qx-plugin-search"
      />
    </div>
  );

  if (embedded) return input;

  return (
    <div className="qx-plugin-toolbar" data-tauri-drag-region>
      {input}
    </div>
  );
}
