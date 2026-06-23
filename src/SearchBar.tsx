import { useRef, useEffect } from "react";
import { useStore } from "./store";

export default function SearchBar({
  onKeyDown,
  embedded = false,
}: {
  onKeyDown: (e: React.KeyboardEvent) => void;
  embedded?: boolean;
}) {
  const { query, setQuery, setSelectedIndex } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
