import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore, type AppEntry } from "./store";
import SearchBar from "./SearchBar";
import ResultsList from "./ResultsList";
import "./App.css";

function App() {
  const { visible, query, setVisible, setQuery, setResults, results, selectedIndex, setSelectedIndex } = useStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onVisibilityChanged(({ visible }) => {
      setVisible(visible);
      if (visible) {
        setQuery("");
        setResults([]);
        setSelectedIndex(0);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    try {
      const res = await invoke<AppEntry[]>("search_apps", { query: q });
      setResults(res);
    } catch {
      setResults([]);
    }
  }, [setResults]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 100);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    const item = results[selectedIndex];

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (item) {
          await invoke("open_app", { path: item.path });
          const win = getCurrentWindow();
          await win.hide();
        }
        break;
      case "Escape":
        await getCurrentWindow().hide();
        break;
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
        backdropFilter: "blur(30px)",
        WebkitBackdropFilter: "blur(30px)",
        borderRadius: 16,
        border: "1px solid var(--border-color)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <SearchBar onKeyDown={handleKeyDown} />
      <ResultsList
        items={results}
        onItemClick={async (item) => {
          await invoke("open_app", { path: item.path });
          await getCurrentWindow().hide();
        }}
      />
    </div>
  );
}

export default App;
