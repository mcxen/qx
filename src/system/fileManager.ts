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

export function getFileManagerSelection(): Promise<FileSelectionSnapshot> {
  return invoke("file_manager_get_selection");
}

export function performFileSelectionOperation(
  request: FileSelectionOperation,
): Promise<FileOperationResult> {
  return invoke("file_manager_perform_operation", { request });
}
