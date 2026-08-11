import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openSystemPath } from "../../system/pathActions";
import type { QxAiFileAttachment } from "./react-agent";
import type { G4fConversation } from "./store";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadQxAiSessions(): Promise<G4fConversation[]> {
  if (!isTauriRuntime()) return [];
  return invoke<G4fConversation[]>("qxai_sessions_load");
}

export async function saveQxAiSessions(conversations: G4fConversation[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("qxai_sessions_save", { conversations });
}

export async function chooseAndImportQxAiAttachments(
  conversationId: string,
): Promise<QxAiFileAttachment[]> {
  const selection = await open({ multiple: true, directory: false });
  const paths = selection ? (Array.isArray(selection) ? selection : [selection]) : [];
  if (paths.length === 0) return [];
  return invoke<QxAiFileAttachment[]>("qxai_session_import_attachments", {
    conversationId,
    paths,
  });
}

export async function deleteQxAiSessionFiles(conversationId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("qxai_session_delete", { conversationId });
}

export async function openQxAiSessionsDirectory(): Promise<void> {
  const path = await invoke<string>("qxai_sessions_directory");
  await openSystemPath(path);
}
