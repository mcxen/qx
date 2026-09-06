import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { bestLauncherRowIndex, type LauncherResultRow } from "./resultRows";

/** Auto-selection follows relevance until the user explicitly chooses a row for this query/scope. */
export function useLauncherSelection(
  rows: LauncherResultRow[],
  query: string,
  scope: string,
  storedIndex: number,
  setSelectedIndex: (index: number) => void,
) {
  const manual = useRef<{ query: string; scope: string; key: string | null }>({ query, scope, key: null });
  const preferredIndex = useMemo(() => bestLauncherRowIndex(rows, query), [rows, query]);
  const stableIndex = manual.current.query === query && manual.current.scope === scope && manual.current.key
    ? rows.findIndex((row) => row.key === manual.current.key)
    : -1;
  const selectedIndex = stableIndex >= 0
    ? stableIndex
    : query.trim() ? preferredIndex : Math.max(0, Math.min(storedIndex, rows.length - 1));

  useLayoutEffect(() => {
    if (stableIndex < 0) manual.current = { query, scope, key: null };
    if (storedIndex !== selectedIndex) setSelectedIndex(selectedIndex);
  }, [query, scope, stableIndex, storedIndex, selectedIndex, setSelectedIndex]);

  const selectRow = useCallback((index: number) => {
    const safeIndex = Math.max(0, Math.min(index, rows.length - 1));
    manual.current = { query, scope, key: rows[safeIndex]?.key ?? null };
    setSelectedIndex(safeIndex);
  }, [rows, query, scope, setSelectedIndex]);

  return { selectedIndex, selectRow };
}
