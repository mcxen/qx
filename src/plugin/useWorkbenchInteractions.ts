import { useCallback, type Dispatch, type SetStateAction, type RefObject } from "react";
import { postPluginWorkbenchEvent } from "./runtime";
import type { PluginWorkbenchState } from "./workbenchTypes";

/** Optimistic collection updates share one guarded navigation port. */
export function useWorkbenchInteractions({ pluginId, workbench, setWorkbench, setWorkbenchDetailOpen, workbenchQueryTimerRef, runWorkbenchNavigation }: {
  pluginId: string;
  workbench: PluginWorkbenchState | null;
  setWorkbench: Dispatch<SetStateAction<PluginWorkbenchState | null>>;
  setWorkbenchDetailOpen: Dispatch<SetStateAction<boolean>>;
  workbenchQueryTimerRef: RefObject<number | null>;
  runWorkbenchNavigation: (action: () => void) => void;
}) {
  const applyWorkbenchSelection = useCallback((id: string) => {
    // Keep pointer and keyboard selection responsive even when the plugin iframe
    // is busy. The plugin still receives the event and remains the source of
    // truth for subsequent workbench publications.
    setWorkbench((current) => {
      if (!current || String(current.selectedId ?? "") === id) return current;
      return { ...current, selectedId: id };
    });
    postPluginWorkbenchEvent(pluginId, { kind: "select", id });
  }, [pluginId]);
  const selectWorkbenchItem = useCallback((id: string) => {
    if (String(workbench?.selectedId ?? "") === id) return;
    runWorkbenchNavigation(() => applyWorkbenchSelection(id));
  }, [applyWorkbenchSelection, runWorkbenchNavigation, workbench?.selectedId]);
  const updateWorkbenchQuery = useCallback((value: string) => {
    if (workbench?.query === value) return;
    runWorkbenchNavigation(() => {
      setWorkbenchDetailOpen(false);
      setWorkbench((current) => current ? { ...current, query: value } : current);
      if (workbenchQueryTimerRef.current !== null) {
        window.clearTimeout(workbenchQueryTimerRef.current);
        workbenchQueryTimerRef.current = null;
      }
      const publish = () => {
        workbenchQueryTimerRef.current = null;
        postPluginWorkbenchEvent(pluginId, { kind: "query", value });
      };
      if (!value) publish();
      else workbenchQueryTimerRef.current = window.setTimeout(publish, 140);
    });
  }, [pluginId, runWorkbenchNavigation, workbench?.query]);
  const selectWorkbenchTab = useCallback((id: string) => {
    if (workbench?.tabs?.find((tabItem) => tabItem.active)?.id === id) return;
    runWorkbenchNavigation(() => {
      if (workbenchQueryTimerRef.current !== null) {
        window.clearTimeout(workbenchQueryTimerRef.current);
        workbenchQueryTimerRef.current = null;
      }
      setWorkbenchDetailOpen(false);
      setWorkbench((current) => current
        ? {
            ...current,
            tabs: current.tabs?.map((tabItem) => ({
              ...tabItem,
              active: tabItem.id === id,
            })),
          }
        : current);
      postPluginWorkbenchEvent(pluginId, { kind: "tab", id });
    });
  }, [pluginId, runWorkbenchNavigation, workbench?.tabs]);
  const updateWorkbenchFilter = useCallback((id: string, value: string) => {
    if (workbench?.filters?.find((filter) => filter.id === id)?.value === value) return;
    runWorkbenchNavigation(() => {
      if (workbenchQueryTimerRef.current !== null) {
        window.clearTimeout(workbenchQueryTimerRef.current);
        workbenchQueryTimerRef.current = null;
      }
      setWorkbenchDetailOpen(false);
      setWorkbench((current) => current
        ? {
            ...current,
            filters: current.filters?.map((filter) => (
              filter.id === id ? { ...filter, value } : filter
            )),
          }
        : current);
      postPluginWorkbenchEvent(pluginId, { kind: "filter", id, value });
    });
  }, [pluginId, runWorkbenchNavigation, workbench?.filters]);

  return { applyWorkbenchSelection, selectWorkbenchItem, updateWorkbenchQuery, selectWorkbenchTab, updateWorkbenchFilter };
}
