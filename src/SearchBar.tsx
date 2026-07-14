import { useCallback, useEffect, useRef } from "react";
import { useStore } from "./store";
import { requestPanelKeyWindow } from "./hooks/usePanelKeyWindow";
import { useT } from "./i18n";

/** Fired when the floating panel is shown / returns to launcher search. */
export const FOCUS_LAUNCHER_SEARCH_EVENT = "qx:focus-launcher-search";

export function requestLauncherSearchFocus(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_LAUNCHER_SEARCH_EVENT));
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

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Key window first so typing lands in the webview (macOS NSPanel).
    // requestPanelKeyWindow is debounced — safe to call from multiple paths.
    requestPanelKeyWindow();
    el.focus({ preventScroll: true });
  }, []);

  // Mount (including remount when returning to launcher from another tab).
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Re-show via Option+Space: component stays mounted, so remount effect does not run.
  // One rAF is enough — the old rAF + 40ms double-focus stacked with App.tsx and
  // made every summon feel sluggish.
  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => focusInput());
    return () => window.cancelAnimationFrame(frame);
  }, [visible, focusInput]);

  useEffect(() => {
    const onRequest = () => focusInput();
    window.addEventListener(FOCUS_LAUNCHER_SEARCH_EVENT, onRequest);
    return () => window.removeEventListener(FOCUS_LAUNCHER_SEARCH_EVENT, onRequest);
  }, [focusInput]);

  const input = (
    <div className="qx-search-wrap">
      <span className="qx-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
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
