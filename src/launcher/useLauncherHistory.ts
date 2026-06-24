import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry, SearchHistoryEntry } from "../store";

export function useLauncherHistory({
  shouldRefreshWhenIdle,
}: {
  shouldRefreshWhenIdle: boolean;
}) {
  const [recentLaunches, setRecentLaunches] = useState<HistoryEntry[]>([]);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const [launches, searches] = await Promise.all([
        invoke<HistoryEntry[]>("get_launch_history", { limit: 5 }),
        invoke<SearchHistoryEntry[]>("get_search_history", { limit: 5 }),
      ]);
      setRecentLaunches(launches);
      setRecentSearches(searches);
    } catch {
      // History is supplemental; Launcher should remain usable if it is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (shouldRefreshWhenIdle) {
      void loadHistory();
    }
  }, [shouldRefreshWhenIdle, loadHistory]);

  return { recentLaunches, recentSearches };
}
