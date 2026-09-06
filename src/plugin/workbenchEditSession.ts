import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginWorkbenchEditEvent,
  PluginWorkbenchEditResult,
  PluginWorkbenchEditSaveResult,
  PluginWorkbenchEditStartResult,
  PluginWorkbenchItem,
} from "./workbenchTypes";
import {
  MAX_WORKBENCH_EDITOR_BYTES,
  workbenchUtf8ByteLength,
} from "./workbenchEditTypes";

export type WorkbenchEditStatus = "starting" | "editing" | "saving" | "conflict" | "error";

export interface WorkbenchEditSession {
  item: PluginWorkbenchItem;
  itemId: string;
  sessionId: string;
  /** True only after the current start request returned an authoritative body. */
  ready: boolean;
  value: string;
  baseline: string;
  revision?: string;
  status: WorkbenchEditStatus;
  message?: string;
  invalid: boolean;
}

interface UseWorkbenchEditSessionOptions {
  onEdit?: (event: PluginWorkbenchEditEvent) => Promise<PluginWorkbenchEditResult>;
  confirmDiscard: (itemTitle: string) => Promise<"save" | "discard" | "continue">;
  canEditItem?: (itemId: string) => boolean;
  messages: {
    inlineUnavailable: string;
    unavailable: string;
    conflict: string;
    saveError: string;
    startError: string;
    byteLimit: (limit: number) => string;
  };
}

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function errorResult(
  event: PluginWorkbenchEditEvent,
  message: string,
): PluginWorkbenchEditResult {
  return {
    phase: event.phase,
    status: "error",
    itemId: event.itemId,
    sessionId: event.sessionId,
    requestId: event.requestId,
    message,
  } as PluginWorkbenchEditResult;
}

export function useWorkbenchEditSession({
  onEdit,
  confirmDiscard,
  canEditItem,
  messages,
}: UseWorkbenchEditSessionOptions) {
  const [session, setSession] = useState<WorkbenchEditSession | null>(null);
  const sessionRef = useRef<WorkbenchEditSession | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current = null;
    };
  }, []);

  const setCurrent = useCallback((next: WorkbenchEditSession | null) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
  }, []);

  const send = useCallback(async (
    event: PluginWorkbenchEditEvent,
  ): Promise<PluginWorkbenchEditResult> => {
    if (!onEdit) return errorResult(event, messages.inlineUnavailable);
    try {
      return await onEdit(event);
    } catch (error) {
      return errorResult(event, String(error).replace(/^Error:\s*/i, "").slice(0, 1_000));
    }
  }, [messages, onEdit]);

  const closeCurrent = useCallback(() => {
    setCurrent(null);
  }, [setCurrent]);

  const saveCurrent = useCallback(async () => {
    const current = sessionRef.current;
    if (
      !current
      || current.status === "saving"
      || current.status === "starting"
      || !current.ready
      || current.invalid
    ) return false;
    if (canEditItem?.(current.itemId) === false) {
      setCurrent({
        ...current,
        status: "error",
        message: messages.unavailable,
      });
      return false;
    }
    const event: PluginWorkbenchEditEvent = {
      phase: "save",
      itemId: current.itemId,
      sessionId: current.sessionId,
      requestId: makeId("edit-save"),
      value: current.value,
    };
    setCurrent({ ...current, status: "saving", message: undefined });
    const result = await send(event);
    const latest = sessionRef.current;
    if (!latest || latest.sessionId !== current.sessionId) return false;
    const saveResult = result as PluginWorkbenchEditSaveResult;
    const identityMatches = saveResult.phase === "save"
      && saveResult.itemId === event.itemId
      && saveResult.sessionId === event.sessionId
      && saveResult.requestId === event.requestId;
    if (identityMatches && saveResult.status === "saved") {
      closeCurrent();
      return true;
    }
    const status: WorkbenchEditStatus = identityMatches && saveResult.status === "conflict"
      ? "conflict"
      : "error";
    setCurrent({
      ...latest,
      status,
      message: saveResult.message || (status === "conflict"
        ? messages.conflict
        : messages.saveError),
    });
    return false;
  }, [canEditItem, closeCurrent, messages, send, setCurrent]);

  const start = useCallback(async (item: PluginWorkbenchItem) => {
    const editor = item.editor;
    if (!editor || editor.disabled || editor.readOnly || !onEdit || canEditItem?.(item.id) === false) return false;
    const current = sessionRef.current;
    if (current) {
      if (current.status === "saving" || current.status === "starting") return false;
      if (current.value !== current.baseline) {
        const decision = await confirmDiscard(current.item.title);
        if (decision === "continue") return false;
        if (decision === "save" && !(await saveCurrent())) return false;
      }
      if (sessionRef.current?.sessionId === current.sessionId) {
        const cancelEvent: PluginWorkbenchEditEvent = {
          phase: "cancel",
          itemId: current.itemId,
          sessionId: current.sessionId,
          requestId: makeId("edit-cancel"),
          value: current.value,
        };
        void send(cancelEvent);
      }
    }
    const sessionId = makeId("edit");
    const requestId = makeId("edit-start");
    const initialValue = editor.initialValue || "";
    const next: WorkbenchEditSession = {
      item,
      itemId: item.id,
      sessionId,
      ready: false,
      value: initialValue,
      baseline: initialValue,
      status: "starting",
      invalid: workbenchUtf8ByteLength(initialValue) > (editor.maxBytes || MAX_WORKBENCH_EDITOR_BYTES),
    };
    setCurrent(next);
    const event: PluginWorkbenchEditEvent = {
      phase: "start",
      itemId: item.id,
      sessionId,
      requestId,
    };
    const result = await send(event);
    const currentAfterStart = sessionRef.current;
    if (!currentAfterStart || currentAfterStart.sessionId !== sessionId) return false;
    const startResult = result as PluginWorkbenchEditStartResult;
    const limit = editor.maxBytes || MAX_WORKBENCH_EDITOR_BYTES;
    const identityMatches = startResult.phase === "start"
      && startResult.itemId === event.itemId
      && startResult.sessionId === event.sessionId
      && startResult.requestId === event.requestId;
    const valid = identityMatches
      && startResult.status === "ready"
      && typeof startResult.value === "string"
      && workbenchUtf8ByteLength(startResult.value) <= limit;
    if (!valid) {
      setCurrent({
        ...currentAfterStart,
        status: "error",
        message: startResult.message || messages.startError,
        invalid: true,
      });
      return false;
    }
    const value = startResult.value || "";
    setCurrent({
      ...currentAfterStart,
      ready: true,
      value,
      baseline: value,
      revision: startResult.revision,
      status: "editing",
      message: undefined,
      invalid: false,
    });
    return true;
  }, [canEditItem, confirmDiscard, messages, onEdit, saveCurrent, send, setCurrent]);

  const input = useCallback((value: string) => {
    const current = sessionRef.current;
    if (!current || !current.ready || current.status === "saving" || current.status === "starting") return;
    const limit = current.item.editor?.maxBytes || MAX_WORKBENCH_EDITOR_BYTES;
    const invalid = workbenchUtf8ByteLength(value) > limit;
    setCurrent({
      ...current,
      value,
      invalid,
      status: invalid ? "error" : "editing",
      message: invalid ? messages.byteLimit(limit) : undefined,
    });
    if (invalid) return;
  }, [messages, setCurrent]);

  const save = saveCurrent;

  const discard = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.status === "saving" || current.status === "starting") return false;
    const event: PluginWorkbenchEditEvent = {
      phase: "cancel",
      itemId: current.itemId,
      sessionId: current.sessionId,
      requestId: makeId("edit-cancel"),
      value: current.value,
    };
    void send(event);
    closeCurrent();
    return true;
  }, [closeCurrent, send]);

  const cancel = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status === "saving" || current.status === "starting") return false;
    if (current.value !== current.baseline) {
      const decision = await confirmDiscard(current.item.title);
      if (decision === "continue") return false;
      if (decision === "save") return saveCurrent();
    }
    return discard();
  }, [confirmDiscard, discard, saveCurrent]);

  return { session, start, input, save, cancel, discard };
}
