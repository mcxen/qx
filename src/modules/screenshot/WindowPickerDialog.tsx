import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WindowInfo } from "../../store";

export default function WindowPickerDialog({
  onSelect,
  onCancel,
}: {
  onSelect: (windowId: number) => void;
  onCancel: () => void;
}) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<WindowInfo[]>("list_capturable_windows")
      .then((result) => {
        if (!cancelled) {
          setWindows(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const grouped = useMemo(() => {
    return windows.reduce<Record<string, WindowInfo[]>>((acc, win) => {
      const appName = win.app_name || "Other";
      acc[appName] = acc[appName] ?? [];
      acc[appName].push(win);
      return acc;
    }, {});
  }, [windows]);

  return (
    <div className="qx-shot-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="qx-shot-window-picker" onClick={(event) => event.stopPropagation()}>
        <div className="qx-shot-modal-header">
          <div>
            <div className="qx-action-title">Select Window</div>
            <div className="qx-shot-muted">{windows.length} capturable windows</div>
          </div>
          <button type="button" className="qx-command-button ghost" onClick={onCancel}>
            Esc
          </button>
        </div>
        <div className="qx-shot-window-list">
          {loading && <div className="qx-empty-state">Scanning windows...</div>}
          {error && <div className="qx-empty-state">{error}</div>}
          {!loading && !error && windows.length === 0 && (
            <div className="qx-empty-state">No capturable windows found</div>
          )}
          {Object.keys(grouped)
            .sort()
            .map((appName) => (
              <div key={appName} className="qx-shot-window-group">
                <div className="qx-section-header">{appName}</div>
                {grouped[appName].map((win) => (
                  <button
                    key={win.id}
                    type="button"
                    className="qx-list-row compact"
                    onClick={() => onSelect(win.id)}
                  >
                    <span className="qx-list-icon" aria-hidden="true">
                      <span className="qx-symbol-icon image" />
                    </span>
                    <span className="qx-list-copy">
                      <span className="qx-list-title">{win.title}</span>
                      <span className="qx-list-subtitle">{win.app_name}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
