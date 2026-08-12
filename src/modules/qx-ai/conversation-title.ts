import type { G4fConversation, G4fMessage } from "./store";

export function isPlaceholderConversationName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return (
    /^Chat\s+\d+$/i.test(trimmed)
    || /^对话\s*\d+$/i.test(trimmed)
    || /^New chat$/i.test(trimmed)
    || /^新对话$/i.test(trimmed)
    || /^Scheduled task$/i.test(trimmed)
    || /^Schedule\b/i.test(trimmed)
  );
}

export function canAutoTitle(conversation: G4fConversation): boolean {
  if (conversation.titleMode === "manual") return false;
  if (conversation.titleMode === "auto") return true;
  return isPlaceholderConversationName(conversation.name);
}

function normalizeTitleSource(content: string): string[] {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\n{2,}|[。！？!?]\s+|\.\s+/)
    .map((part) =>
      part
        .replace(/[#*_~>\-[\](){}]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

export function fallbackTitleFromMessages(
  messages: G4fMessage[],
  maxLength = 28,
): string | null {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUser) return null;
  const paragraphs = normalizeTitleSource(firstUser.content);
  const source = (paragraphs[0] || firstUser.content.replace(/\s+/g, " ").trim()).trim();
  if (!source) return null;
  const chars = [...source];
  if (chars.length <= maxLength) return source;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

export function sanitizeAiTitle(raw: string, maxLength = 24): string | null {
  let title = raw
    .trim()
    .replace(/^["'「『《]+|["'」』》]+$/g, "")
    .replace(/^标题[:：]\s*/i, "")
    .replace(/^title[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  title = title.split(/\n/)[0]?.trim() || "";
  if (!title || title.length < 2) return null;
  if (!/[\p{L}\p{N}]/u.test(title) || title.includes("\uFFFD")) return null;
  if (/^(chat|new chat|对话|新对话)\b/i.test(title)) return null;
  const chars = [...title];
  return chars.length > maxLength
    ? `${chars.slice(0, maxLength - 1).join("")}…`
    : title;
}

/** Apply the first-user-message fallback only to placeholder or corrupt names. */
export function withAutoTitle(conversation: G4fConversation): G4fConversation {
  if (!canAutoTitle(conversation)) return conversation;
  const title = fallbackTitleFromMessages(conversation.messages);
  if (!title) return conversation;
  if (conversation.name.trim() === title) {
    return { ...conversation, titleMode: conversation.titleMode ?? "auto" };
  }
  if (
    isPlaceholderConversationName(conversation.name)
    || !/[\p{L}\p{N}]/u.test(conversation.name)
    || conversation.name.includes("\uFFFD")
  ) {
    return { ...conversation, name: title, titleMode: "auto" };
  }
  return conversation;
}
