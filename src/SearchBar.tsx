import { useRef, useEffect } from "react";
import { useStore } from "./store";

export default function SearchBar({
  onKeyDown,
}: {
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { query, setQuery, setSelectedIndex } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="qx-plugin-toolbar">
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
    </div>
  );
}
