import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface MacroRecordingEvent {
  cursor_x: number | null;
  cursor_y: number | null;
  mouse_button: string | null;
  button_pressed: boolean;
}
function queryNumber(name: string, fallback: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Transparent, click-through display surface used by macro capture only.
 * Position updates mutate one DOM node; React is not re-rendered for every
 * mouse move, which keeps the visualizer independent from the Workbench.
 */
export default function MacroCursorOverlayWindow() {
  const pointerRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [clickFlash, setClickFlash] = useState(false);

  useEffect(() => {
    document.body.classList.add("qx-macro-cursor-overlay-body");
    return () => document.body.classList.remove("qx-macro-cursor-overlay-body");
  }, []);

  useEffect(() => {
    const monitorX = queryNumber("monitorX", 0);
    const monitorY = queryNumber("monitorY", 0);
    const monitorScale = queryNumber("scale", 1);
    const isMac = navigator.platform.toLowerCase().includes("mac");
    // Native event units are point-based on macOS and physical pixels on
    // Windows. Each overlay WebView has the scale factor of its display.
    const cssScale = isMac ? 1 : (window.devicePixelRatio || monitorScale || 1);

    const unlisten = listen<MacroRecordingEvent>("macro:recording", ({ payload }) => {
      const element = pointerRef.current;
      if (!element || payload.cursor_x == null || payload.cursor_y == null) return;

      const x = (payload.cursor_x - monitorX) / cssScale;
      const y = (payload.cursor_y - monitorY) / cssScale;
      const padding = 48;
      const inside = x >= -padding
        && y >= -padding
        && x <= window.innerWidth + padding
        && y <= window.innerHeight + padding;
      element.style.opacity = inside ? "1" : "0";
      if (inside) {
        element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-3px, -2px)`;
      }

      if (payload.mouse_button && payload.button_pressed) {
        setClickFlash(true);
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          setClickFlash(false);
          flashTimerRef.current = null;
        }, 260);
      }
    });

    return () => {
      void unlisten.then((dispose) => dispose());
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  return (
    <div className="qx-macro-cursor-overlay" aria-hidden="true">
      <div ref={pointerRef} className={`qx-macro-cursor-pointer${clickFlash ? " is-clicking" : ""}`}>
        <span className="qx-macro-cursor-ring" />
        <svg viewBox="0 0 32 42" className="qx-macro-cursor-glyph" focusable="false">
          <path d="M3 2.5 28.5 25l-11.2 1.4 6.1 11.8-5.3 2.7-6.2-11.8-7.1 8.8Z" />
        </svg>
      </div>
    </div>
  );
}
