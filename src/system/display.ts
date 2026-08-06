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

export interface DisplayBrightnessControl {
  id: string;
  name: string;
  backend: "native" | "ddc" | string;
  current: number | null;
  max: number;
  isBuiltin: boolean;
  supported: boolean;
  error?: string | null;
}

/** Enumerate displays via the root display service (`display_list`). */
export function listDisplays(): Promise<DisplayDescriptor[]> {
  return invoke<DisplayDescriptor[]>("display_list");
}

/** List native and embedded DDC/CI brightness targets. */
export function listDisplayBrightnessControls(): Promise<DisplayBrightnessControl[]> {
  return invoke<DisplayBrightnessControl[]>("display_brightness_list");
}

/** Set a brightness target returned by listDisplayBrightnessControls. */
export function setDisplayBrightness(displayId: string, value: number): Promise<void> {
  return invoke("display_brightness_set", {
    displayId,
    value: Math.max(0, Math.min(100, Math.round(value))),
  });
}
