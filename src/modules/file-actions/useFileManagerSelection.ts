import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getFileManagerSelection, type FileSelectionSnapshot } from "../../system";

const EMPTY_SELECTION: FileSelectionSnapshot = {
  revision: 0,
  capturedAtMs: 0,
  source: "none",
  items: [],
  error: null,
};

/** Shared, revision-aware selection session for File Actions and QxPreview. */
export function useFileManagerSelection() {
  const [snapshot, setSnapshot] = useState<FileSelectionSnapshot>(EMPTY_SELECTION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef(0);

  const applySnapshot = useCallback((next: FileSelectionSnapshot) => {
    if (next.revision < revisionRef.current) return;
    revisionRef.current = next.revision;
    setSnapshot(next);
    setError(next.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<FileSelectionSnapshot>("file-manager:selection", (event) => {
      if (!cancelled) applySnapshot(event.payload);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    const refresh = () => getFileManagerSelection()
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(String(cause));
          setLoading(false);
        }
      });
    void refresh();
    const retry = window.setTimeout(() => void refresh(), 450);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      unlisten?.();
    };
  }, [applySnapshot]);

  return { snapshot, loading, error, setError };
}
