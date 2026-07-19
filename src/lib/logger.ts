import { invoke } from "@tauri-apps/api/core";

export type QxLogLevel = "error" | "warn" | "info" | "debug";

export interface QxLogFields {
  [key: string]: unknown;
}

export interface QxLogger {
  error: (message: string, fields?: QxLogFields) => void;
  warn: (message: string, fields?: QxLogFields) => void;
  info: (message: string, fields?: QxLogFields) => void;
  debug: (message: string, fields?: QxLogFields) => void;
}

const LEVEL_WEIGHT: Record<QxLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let configuredLevel: QxLogLevel = "debug";
let devMode = false;
let loggingEnabled = false;
let consoleCaptureInstalled = false;
let globalCaptureInstalled = false;
let flushScheduled = false;
const queue: Array<{
  level: QxLogLevel;
  target: string;
  message: string;
  fields: QxLogFields;
}> = [];

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function normalizeLevel(level: string | undefined): QxLogLevel {
  return level === "error" || level === "warn" || level === "debug" ? level : "info";
}

function shouldSend(level: QxLogLevel): boolean {
  if (!loggingEnabled && !devMode) return false;
  const threshold = devMode ? "debug" : configuredLevel;
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[threshold];
}

function safeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function summarizeLogValue(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(safeValue(value));
  } catch {
    return String(value);
  }
}

function sanitizeFields(fields?: QxLogFields): QxLogFields {
  if (!fields) return {};
  const next: QxLogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    next[key] = safeValue(value);
  }
  return next;
}

function enqueue(level: QxLogLevel, target: string, message: string, fields?: QxLogFields): void {
  if (!shouldSend(level) || !isTauriRuntime()) return;
  queue.push({
    level,
    target,
    message: String(message || ""),
    fields: sanitizeFields(fields),
  });
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (flushScheduled) return;
  flushScheduled = true;
  window.setTimeout(() => {
    flushScheduled = false;
    const batch = queue.splice(0, queue.length);
    for (const item of batch) {
      void invoke("qx_log_event", item).catch(() => {});
    }
  }, 0);
}

export function configureQxLogger(options: {
  enabled?: boolean;
  level?: string;
  devMode?: boolean;
}): void {
  loggingEnabled = Boolean(options.enabled);
  configuredLevel = normalizeLevel(options.level);
  devMode = Boolean(options.devMode);
}

export function qxLog(level: QxLogLevel, target: string, message: string, fields?: QxLogFields): void {
  enqueue(level, target, message, fields);
}

export function createQxLogger(target: string): QxLogger {
  return {
    error: (message, fields) => qxLog("error", target, message, fields),
    warn: (message, fields) => qxLog("warn", target, message, fields),
    info: (message, fields) => qxLog("info", target, message, fields),
    debug: (message, fields) => qxLog("debug", target, message, fields),
  };
}

export function installGlobalQxLogging(): void {
  if (globalCaptureInstalled || typeof window === "undefined") return;
  globalCaptureInstalled = true;
  window.addEventListener("error", (event) => {
    qxLog("error", "main.window", event.message || "Unhandled window error", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    qxLog("error", "main.window", "Unhandled promise rejection", {
      reason: event.reason,
    });
  });
}

export function installDevConsoleCapture(): void {
  if (consoleCaptureInstalled || typeof window === "undefined") return;
  consoleCaptureInstalled = true;
  const original = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    qxLog("error", "main.console", args.map(summarizeLogValue).join(" "), { args });
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    qxLog("warn", "main.console", args.map(summarizeLogValue).join(" "), { args });
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    qxLog("info", "main.console", args.map(summarizeLogValue).join(" "), { args });
  };
  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    qxLog("debug", "main.console", args.map(summarizeLogValue).join(" "), { args });
  };
}
