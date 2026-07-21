/**
 * Qx system OCR port — features invoke this instead of raw engine details.
 */
import { invoke } from "@tauri-apps/api/core";

export interface OcrRecognizeResult {
  id: string;
  text: string;
  engine: string;
  source: string;
  sourcePath?: string | null;
  charCount: number;
  createdAt: string;
}

export interface OcrHistoryEntry {
  id: string;
  text: string;
  source: string;
  sourcePath?: string | null;
  engine: string;
  createdAt: string;
  charCount: number;
}

export interface OcrStatus {
  enabled: boolean;
  engine: string;
  modelSize: string;
  models: { downloaded?: boolean };
  platform: string;
}

export async function ocrRecognizePath(
  path: string,
  source: "clipboard" | "screenshot" | "file" = "file",
): Promise<OcrRecognizeResult> {
  return invoke<OcrRecognizeResult>("ocr_recognize_path", { path, source });
}

export async function ocrRecognizeClipboardImage(id: string): Promise<OcrRecognizeResult> {
  return invoke<OcrRecognizeResult>("ocr_recognize_clipboard_image", { id });
}

export async function ocrListHistory(limit = 80): Promise<OcrHistoryEntry[]> {
  return invoke<OcrHistoryEntry[]>("ocr_list_history", { limit });
}

export async function ocrDeleteHistory(id: string): Promise<void> {
  await invoke("ocr_delete_history", { id });
}

export async function ocrClearHistory(): Promise<void> {
  await invoke("ocr_clear_history");
}

export async function ocrCopyResultText(text: string): Promise<void> {
  await invoke("ocr_copy_result_text", { text });
}

export async function ocrStatus(): Promise<OcrStatus> {
  return invoke<OcrStatus>("ocr_status");
}
