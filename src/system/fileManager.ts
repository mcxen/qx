import { invoke } from "@tauri-apps/api/core";

export interface SelectedFile {
  path: string;
  name: string;
  parent: string;
  kind: "file" | "folder" | "symlink";
  exists: boolean;
}

export interface FileSelectionSnapshot {
  revision: number;
  capturedAtMs: number;
  source: "finder" | "explorer" | "operation" | "none" | "unsupported";
  items: SelectedFile[];
  error?: string | null;
}

export type FileSelectionOperation =
  | { revision: number; operation: "rename"; path: string; name: string }
  | { revision: number; operation: "collect" | "compress"; name: string }
  | { revision: number; operation: "extract" };

export interface FileOperationResult {
  operation: FileSelectionOperation["operation"];
  outputPaths: string[];
  affectedCount: number;
}

export interface FilePreviewInfo {
  name: string;
  extension: string;
  kind: "file" | "folder" | "symlink";
  size?: number | null;
  modifiedAtMs?: number | null;
}

export interface FolderPreviewEntry {
  name: string;
  kind: "file" | "folder";
  size?: number | null;
}

export interface FolderPreview {
  entries: FolderPreviewEntry[];
  truncated: boolean;
}

export function getFileManagerSelection(): Promise<FileSelectionSnapshot> {
  return invoke("file_manager_get_selection");
}

export function performFileSelectionOperation(
  request: FileSelectionOperation,
): Promise<FileOperationResult> {
  return invoke("file_manager_perform_operation", { request });
}

export function getFilePreviewInfo(revision: number, index: number): Promise<FilePreviewInfo> {
  return invoke("file_preview_info", { revision, index });
}

export function readFilePreview(revision: number, index: number, maxBytes?: number): Promise<ArrayBuffer> {
  return invoke("file_preview_read", { revision, index, maxBytes });
}

export function getFolderPreview(revision: number, index: number): Promise<FolderPreview> {
  return invoke("file_preview_folder", { revision, index });
}
