import { useCallback, useEffect, useRef } from "react";
import { useT } from "../i18n";
import { subscribePluginWorkbenchEdit, postPluginWorkbenchEvent } from "./runtime";
import { WorkbenchEditBridge, workbenchEditError } from "./workbenchEditBridge";
import { MAX_WORKBENCH_EDITOR_BYTES, workbenchUtf8ByteLength, type PluginWorkbenchEditEvent } from "./workbenchEditTypes";

/** Editor RPC lifecycle belongs to the active panel, not collection rendering. */
export function useWorkbenchEditBridge(pluginId: string, active: boolean) {
  const t = useT();
  const workbenchEditBridgeRef = useRef<WorkbenchEditBridge | null>(null);
  if (!workbenchEditBridgeRef.current) {
    workbenchEditBridgeRef.current = new WorkbenchEditBridge();
  }
  const requestWorkbenchEdit = useCallback((event: PluginWorkbenchEditEvent) => {
    if (!pluginId) return Promise.resolve(workbenchEditError(event, "Plugin panel is unavailable."));
    if (
      (event.phase === "input" || event.phase === "save")
      && workbenchUtf8ByteLength(event.value) > MAX_WORKBENCH_EDITOR_BYTES
    ) {
      return Promise.resolve(workbenchEditError(
        event,
        t("plugins.workbench.editor.byteLimit", "Text exceeds the {n} byte limit.")
          .replace("{n}", String(MAX_WORKBENCH_EDITOR_BYTES)),
      ));
    }
    return workbenchEditBridgeRef.current!.request(
      pluginId,
      event,
      (targetPluginId, targetEvent) => postPluginWorkbenchEvent(
        targetPluginId,
        { kind: "edit", ...targetEvent },
      ),
    );
  }, [pluginId, t]);

  useEffect(() => {
    if (!active || !pluginId) return;
    const unsubscribe = subscribePluginWorkbenchEdit((payload) => {
      if (payload.pluginId === pluginId) workbenchEditBridgeRef.current?.resolve(payload);
    });
    return () => {
      unsubscribe();
      workbenchEditBridgeRef.current?.rejectPlugin(pluginId, "Plugin panel was closed.");
    };
  }, [active, pluginId]);
  return requestWorkbenchEdit;
}
