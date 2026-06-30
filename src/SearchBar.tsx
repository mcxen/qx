import { useRef, useEffect } from "react";
import { useStore } from "./store";
import { requestPanelKeyWindow } from "./hooks/usePanelKeyWindow";

export default function SearchBar({
  onKeyDown,
  embedded = false,
}: {
  onKeyDown: (e: React.KeyboardEvent) => void;
  embedded?: boolean;
}) {
  const query = useStore((state) => state.query);
  const setQuery = useStore((state) => state.setQuery);
  const setSelectedIndex = useStore((state) => state.setSelectedIndex);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    requestPanelKeyWindow();
  }, []);

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
        placeholder="Search for apps and commands..."
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
