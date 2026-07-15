/**
 * System display port — Qx product foundation.
 * Features must not re-implement monitor discovery; invoke only these APIs.
 */
import { invoke } from "@tauri-apps/api/core";

export interface DisplayDescriptor {
  id: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  isBuiltin: boolean;
}

/** Enumerate displays via the root display service (`display_list`). */
export function listDisplays(): Promise<DisplayDescriptor[]> {
  return invoke<DisplayDescriptor[]>("display_list");
}
