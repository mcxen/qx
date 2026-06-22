import { useRef, useEffect } from "react";
import { useStore } from "./store";

export default function SearchBar({ onKeyDown }: { onKeyDown: (e: React.KeyboardEvent) => void }) {
  const { query, setQuery, setSelectedIndex } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative px-3 pt-3">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search applications..."
        style={{
          width: "100%",
          height: 44,
          padding: "0 14px",
          fontSize: 15,
          border: "none",
          borderRadius: 10,
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          outline: "none",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-sm)",
        }}
      />
    </div>
  );
}
