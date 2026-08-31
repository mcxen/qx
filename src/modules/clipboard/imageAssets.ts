import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export const CLIPBOARD_THUMBNAIL_MAX_EDGE = 320;
export const CLIPBOARD_DETAIL_MAX_EDGE = 1600;

export interface ClipboardPreviewAsset {
  path: string;
  url: string;
}

const inFlight = new Map<string, Promise<ClipboardPreviewAsset | null>>();

/**
 * Resolve a bounded, rebuildable clipboard preview under Qx's asset scope.
 *
 * The path crosses IPC, never the image bytes. `convertFileSrc` lets the
 * WebView stream/decode the cached derivative without expanding a Rust
 * `Vec<u8>` into a JSON number array and then copying it into a Blob.
 */
export function resolveClipboardPreviewAsset(
  sourcePath: string,
  maxEdge: number,
): Promise<ClipboardPreviewAsset | null> {
  const key = `${sourcePath}\0${maxEdge}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = invoke<string | null>("clipboard_file_preview", {
    path: sourcePath,
    maxEdge,
  })
    .then((path) => path ? { path, url: convertFileSrc(path) } : null)
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}
