/**
 * Semantic local-path actions.
 *
 * The Rust port owns platform differences and intentionally avoids WebView
 * opener ACL/canonicalization behavior. This lets Finder/Explorer reveal paths
 * that came from Spotlight or another system index even when Qx cannot read the
 * target itself yet.
 */
import { invoke } from "@tauri-apps/api/core";

/** Open a local file or directory with the platform shell. */
export function openSystemPath(path: string): Promise<void> {
  return invoke<void>("plugin_system_open_path", { path });
}

/** Reveal a local item in Finder/Explorer. */
export function revealSystemPath(path: string): Promise<void> {
  return invoke<void>("plugin_system_reveal_path", { path });
}
