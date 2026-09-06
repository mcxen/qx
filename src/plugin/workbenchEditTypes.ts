/**
 * Narrow, versioned contract for host-owned Workbench inline editing.
 *
 * The event envelope carries identity so the host can drop late responses.
 * Plugin handlers return only domain status/value/revision/message; the SDK
 * fills the identity back into the response before it crosses the iframe.
 */

export const MAX_WORKBENCH_EDITOR_BYTES = 65_536;

export interface PluginWorkbenchEditor {
  /** Initial authoritative value when the plugin already has it in memory. */
  initialValue?: string;
  placeholder?: string;
  /** Visible rows for the host editor. Clamped to 3-24. */
  rows?: number;
  /** UTF-8 byte limit. The host clamps this to 64 KiB and never truncates. */
  maxBytes?: number;
  disabled?: boolean;
  readOnly?: boolean;
}

export type PluginWorkbenchEditEvent =
  | {
      phase: "start";
      itemId: string;
      sessionId: string;
      requestId: string;
    }
  | {
      phase: "input";
      itemId: string;
      sessionId: string;
      requestId: string;
      value: string;
    }
  | {
      phase: "save";
      itemId: string;
      sessionId: string;
      requestId: string;
      value: string;
    }
  | {
      phase: "cancel";
      itemId: string;
      sessionId: string;
      requestId: string;
      value?: string;
    };

export interface PluginWorkbenchEditStartResult {
  phase: "start";
  status: "ready" | "error";
  itemId: string;
  sessionId: string;
  requestId: string;
  /** The authoritative body; required when status is ready. */
  value?: string;
  /** Opaque plugin-owned revision token. */
  revision?: string;
  message?: string;
}

export interface PluginWorkbenchEditInputResult {
  phase: "input";
  status: "accepted" | "error";
  itemId: string;
  sessionId: string;
  requestId: string;
  message?: string;
}

export interface PluginWorkbenchEditSaveResult {
  phase: "save";
  status: "saved" | "conflict" | "error";
  itemId: string;
  sessionId: string;
  requestId: string;
  /** Optional canonical body returned after a successful save. */
  value?: string;
  /** Opaque plugin-owned revision token. */
  revision?: string;
  message?: string;
}

export interface PluginWorkbenchEditCancelResult {
  phase: "cancel";
  status: "cancelled" | "error";
  itemId: string;
  sessionId: string;
  requestId: string;
  message?: string;
}

export type PluginWorkbenchEditResult =
  | PluginWorkbenchEditStartResult
  | PluginWorkbenchEditInputResult
  | PluginWorkbenchEditSaveResult
  | PluginWorkbenchEditCancelResult;

export type PluginWorkbenchEditHandlerResult =
  | { status: "ready"; value: string; revision?: string; message?: string }
  | { status: "accepted"; message?: string }
  | { status: "saved" | "conflict" | "error"; value?: string; revision?: string; message?: string }
  | { status: "cancelled" | "error"; message?: string };

export interface PluginWorkbenchEditPayload {
  pluginId: string;
  runtimeId: string;
  result: PluginWorkbenchEditResult;
}

function shortText(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  return String(value).slice(0, max);
}

export function workbenchUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizePluginWorkbenchEditor(value: unknown): PluginWorkbenchEditor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const maxBytes = Number(raw.maxBytes);
  const limit = Number.isFinite(maxBytes)
    ? Math.max(1, Math.min(MAX_WORKBENCH_EDITOR_BYTES, Math.floor(maxBytes)))
    : MAX_WORKBENCH_EDITOR_BYTES;
  const initialValue = typeof raw.initialValue === "string" ? raw.initialValue : undefined;
  // Reject an oversized initial value as a whole. The editor must never turn
  // a partial card value into a successful save.
  if (initialValue != null && workbenchUtf8ByteLength(initialValue) > limit) return undefined;
  return {
    initialValue,
    placeholder: shortText(raw.placeholder, 500),
    rows: Math.max(3, Math.min(24, Math.round(Number(raw.rows) || 8))),
    maxBytes: limit,
    disabled: raw.disabled === true,
    readOnly: raw.readOnly === true,
  };
}

/** Trust boundary for typed inline-editor responses from a plugin iframe. */
export function normalizePluginWorkbenchEditResult(value: unknown): PluginWorkbenchEditResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const phase = raw.phase;
  if (phase !== "start" && phase !== "input" && phase !== "save" && phase !== "cancel") return undefined;
  const identity = (candidate: unknown): string | undefined => (
    typeof candidate === "string" && candidate.length > 0 && candidate.length <= 256
      ? candidate
      : undefined
  );
  const itemId = identity(raw.itemId);
  const sessionId = identity(raw.sessionId);
  const requestId = identity(raw.requestId);
  if (!itemId || !sessionId || !requestId) return undefined;
  const message = shortText(raw.message, 1_000);
  const revision = shortText(raw.revision, 256);
  const responseValue = typeof raw.value === "string" ? raw.value : undefined;
  const valueTooLarge = responseValue != null
    && workbenchUtf8ByteLength(responseValue) > MAX_WORKBENCH_EDITOR_BYTES;
  if (phase === "start") {
    const status = raw.status === "ready" && !valueTooLarge && responseValue != null ? "ready" : "error";
    return {
      phase,
      status,
      itemId,
      sessionId,
      requestId,
      value: status === "ready" ? responseValue : undefined,
      revision,
      message: status === "error"
        ? message || (valueTooLarge
          ? "The plugin returned text larger than the 64 KiB editor limit."
          : "The plugin did not return an editable value.")
        : message,
    };
  }
  if (phase === "save") {
    const requestedStatus = raw.status === "saved" || raw.status === "conflict" || raw.status === "error"
      ? raw.status
      : "error";
    const status = valueTooLarge ? "error" : requestedStatus;
    return {
      phase,
      status,
      itemId,
      sessionId,
      requestId,
      value: valueTooLarge ? undefined : responseValue,
      revision,
      message: valueTooLarge
        ? "The plugin returned text larger than the 64 KiB editor limit."
        : message,
    };
  }
  if (phase === "input") {
    return {
      phase,
      status: raw.status === "accepted" ? "accepted" : "error",
      itemId,
      sessionId,
      requestId,
      message: valueTooLarge
        ? "The plugin returned text larger than the 64 KiB editor limit."
        : message,
    };
  }
  return {
    phase,
    status: raw.status === "cancelled" ? "cancelled" : "error",
    itemId,
    sessionId,
    requestId,
    message,
  };
}
