import { islandHost } from "../../island";

function sessionId(conversationId: string): string {
  return `qxai.run.${conversationId}`;
}

export function showQxAiRun(conversationId: string, name: string): void {
  islandHost.show({
    id: sessionId(conversationId),
    priority: "task",
    source: "module",
    placement: "docked-or-float",
    sticky: true,
    progressSilent: true,
    content: {
      identity: { iconName: "bot" },
      primary: name,
      meter: { kind: "activity", activity: "dots" },
    },
  });
}

export function completeQxAiRun(conversationId: string, name: string): void {
  islandHost.show({
    id: sessionId(conversationId),
    priority: "toast",
    source: "module",
    placement: "docked-or-float",
    ttlMs: 3_000,
    content: {
      identity: { iconName: "bot" },
      primary: name,
      tone: "success",
    },
  });
}

export function failQxAiRun(conversationId: string, name: string, error: unknown): void {
  islandHost.show({
    id: sessionId(conversationId),
    priority: "error",
    source: "module",
    placement: "docked-or-float",
    ttlMs: 8_000,
    content: {
      identity: { iconName: "bot" },
      primary: name,
      secondary: String(error),
      tone: "danger",
    },
  });
}

export function dismissQxAiRun(conversationId: string): void {
  islandHost.dismiss(sessionId(conversationId));
}
