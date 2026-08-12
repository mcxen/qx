import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const SAVE_DELAY_MS = 500;
const RESTORE_WINDOW_MS = 1800;
const MAX_SAVED_POSITIONS = 256;
const STORAGE_KEY = "qx:workbench:reading-progress:v1";

interface SavedReadingPosition {
  progress: number;
  updatedAt: number;
}

type ReadingPositionLedger = Record<string, SavedReadingPosition>;

export function clampWorkbenchReadingProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function workbenchReadingPositionKey(
  pluginId: string,
  scope: string,
  contentId: string,
): string {
  return JSON.stringify([pluginId, scope, contentId]);
}

export function workbenchScrollTopForProgress(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight)
    * (clampWorkbenchReadingProgress(progress) / 100);
}

function progressFor(element: HTMLElement): number {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return 0;
  return clampWorkbenchReadingProgress((element.scrollTop / maxScroll) * 100);
}

function readLedger(): ReadingPositionLedger {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed as ReadingPositionLedger : {};
  } catch {
    return {};
  }
}

function readProgress(key: string): number {
  const entry = readLedger()[key];
  return clampWorkbenchReadingProgress(Number(entry?.progress) || 0);
}

function saveProgress(key: string, progress: number): void {
  try {
    const ledger = readLedger();
    ledger[key] = {
      progress: clampWorkbenchReadingProgress(progress),
      updatedAt: Date.now(),
    };
    const entries = Object.entries(ledger)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_SAVED_POSITIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Reading restoration is best effort when storage is unavailable.
  }
}

interface ReadingSession {
  key: string;
  progress: number;
  restoring: boolean;
  saveTimer: number | null;
}

/**
 * Host-owned Workbench reading-position protocol.
 *
 * Each stable content key gets an independent normalized position. New detail
 * records start at the top; returning to a record restores its prior position.
 * Percentages survive detail width, font, and asynchronous media changes more
 * reliably than raw pixels.
 */
export function useWorkbenchReadingPosition(
  contentKey: string | null,
  scrollRef: RefObject<HTMLDivElement | null>,
): void {
  const sessionRef = useRef<ReadingSession | null>(null);

  const update = useCallback(() => {
    const element = scrollRef.current;
    const session = sessionRef.current;
    if (!element || !session || session.key !== contentKey) return;
    if (session.restoring) return;
    session.progress = progressFor(element);
    if (session.saveTimer != null) window.clearTimeout(session.saveTimer);
    session.saveTimer = window.setTimeout(() => {
      saveProgress(session.key, session.progress);
      session.saveTimer = null;
    }, SAVE_DELAY_MS);
  }, [contentKey, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [scrollRef, update]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !contentKey) {
      sessionRef.current = null;
      return;
    }

    const storedProgress = readProgress(contentKey);
    const session: ReadingSession = {
      key: contentKey,
      progress: storedProgress,
      restoring: true,
      saveTimer: null,
    };
    sessionRef.current = session;

    const restore = () => {
      if (sessionRef.current !== session || !session.restoring) return;
      element.scrollTo({
        top: workbenchScrollTopForProgress(
          storedProgress,
          element.scrollHeight,
          element.clientHeight,
        ),
        left: 0,
        behavior: "auto",
      });
    };
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      restore();
      secondFrame = window.requestAnimationFrame(restore);
    });
    const resizeObserver = new ResizeObserver(restore);
    const observeChildren = () => {
      for (const child of element.children) resizeObserver.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      restore();
    });
    mutationObserver.observe(element, { childList: true });
    const stopRestoring = () => {
      if (sessionRef.current !== session) return;
      session.progress = progressFor(element);
      session.restoring = false;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
    const restoreTimer = window.setTimeout(stopRestoring, RESTORE_WINDOW_MS);
    element.addEventListener("wheel", stopRestoring, { once: true, passive: true });
    element.addEventListener("pointerdown", stopRestoring, { once: true, passive: true });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame != null) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(restoreTimer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("wheel", stopRestoring);
      element.removeEventListener("pointerdown", stopRestoring);
      if (session.saveTimer != null) window.clearTimeout(session.saveTimer);
      saveProgress(session.key, session.progress);
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [contentKey, scrollRef]);
}
