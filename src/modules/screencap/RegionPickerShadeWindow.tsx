/** Per-display outer shade while the interactive picker follows the pointer. */
import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const SHADE_LABEL_PREFIX = "region-picker-shade-";

function monitorIdFromSurface(): number | null {
  // Prefer the window label (stable across shade reuse); fall back to query.
  try {
    const label = getCurrentWindow().label;
    if (label.startsWith(SHADE_LABEL_PREFIX)) {
      const id = Number(label.slice(SHADE_LABEL_PREFIX.length));
      if (Number.isFinite(id)) return id;
    }
  } catch {
    /* non-Tauri preview */
  }
  const raw = new URLSearchParams(window.location.search).get("monitorId");
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export default function RegionPickerShadeWindow() {
  const monitorId = useMemo(() => monitorIdFromSurface(), []);

  useEffect(() => {
    document.body.classList.add("qx-region-picker-shade-window-body");
    return () => {
      document.body.classList.remove("qx-region-picker-shade-window-body");
    };
  }, []);

  const activateDisplay = () => {
    if (monitorId == null) return;
    // Bring the interactive picker onto this display immediately.
    void invoke("screencap_select_display", { monitorId }).catch(() => {});
  };

  return (
    <div
      className="qx-region-picker-shade-window"
      role="presentation"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        activateDisplay();
      }}
    />
  );
}
