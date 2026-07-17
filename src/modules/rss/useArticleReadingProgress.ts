import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const SAVE_DELAY_MS = 600;
const RESTORE_WINDOW_MS = 1800;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function progressFor(element: HTMLElement): number {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return 100;
  return clampProgress((element.scrollTop / maxScroll) * 100);
}

interface ArticleReadingProgressOptions {
  articleId: number | null;
  storedProgress: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  saveProgress: (articleId: number, progress: number) => Promise<void>;
}

interface ReadingSession {
  articleId: number;
  progress: number;
  restoring: boolean;
  saveTimer: number | null;
}

/**
 * RSS reading-session port: restores a normalized article position and writes
 * it back after scroll settles. Percentage survives font, width and window-size
 * changes better than a raw pixel offset.
 */
export function useArticleReadingProgress({
  articleId,
  storedProgress,
  scrollRef,
  saveProgress,
}: ArticleReadingProgressOptions): number {
  const [progress, setProgress] = useState(0);
  const sessionRef = useRef<ReadingSession | null>(null);

  const persist = useCallback((id: number, nextProgress: number) => {
    const normalized = clampProgress(nextProgress);
    void saveProgress(id, normalized);
  }, [saveProgress]);

  const update = useCallback(() => {
    const element = scrollRef.current;
    const session = sessionRef.current;
    if (!element || !session || session.articleId !== articleId) return;
    const nextProgress = progressFor(element);
    session.progress = nextProgress;
    setProgress(nextProgress);
    if (session.restoring) return;
    if (session.saveTimer != null) window.clearTimeout(session.saveTimer);
    session.saveTimer = window.setTimeout(() => {
      persist(session.articleId, session.progress);
      session.saveTimer = null;
    }, SAVE_DELAY_MS);
  }, [articleId, persist, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [update, scrollRef]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || articleId == null) {
      sessionRef.current = null;
      setProgress(0);
      return;
    }

    const restoredProgress = clampProgress(storedProgress);
    const session: ReadingSession = {
      articleId,
      progress: restoredProgress,
      restoring: true,
      saveTimer: null,
    };
    sessionRef.current = session;
    setProgress(restoredProgress);

    const restore = () => {
      if (sessionRef.current !== session || !session.restoring) return;
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTo({ top: maxScroll * (restoredProgress / 100), left: 0, behavior: "auto" });
    };
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      restore();
      secondFrame = window.requestAnimationFrame(restore);
    });
    const resizeObserver = new ResizeObserver(restore);
    const content = element.firstElementChild;
    if (content) resizeObserver.observe(content);
    const stopRestoring = () => {
      if (sessionRef.current !== session) return;
      session.restoring = false;
      resizeObserver.disconnect();
    };
    const restoreTimer = window.setTimeout(stopRestoring, RESTORE_WINDOW_MS);
    element.addEventListener("wheel", stopRestoring, { once: true, passive: true });
    element.addEventListener("pointerdown", stopRestoring, { once: true, passive: true });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame != null) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(restoreTimer);
      resizeObserver.disconnect();
      element.removeEventListener("wheel", stopRestoring);
      element.removeEventListener("pointerdown", stopRestoring);
      session.restoring = false;
      if (session.saveTimer != null) {
        window.clearTimeout(session.saveTimer);
        session.saveTimer = null;
      }
      // Persist the retiring session's own snapshot. The scroll DOM is reused
      // by React and may already describe the next article during cleanup.
      persist(session.articleId, session.progress);
      if (sessionRef.current === session) sessionRef.current = null;
    };
    // storedProgress is intentionally sampled only when articleId changes.
    // A successful background save updates the store but must not re-run
    // restoration and pull the reader back while they continue scrolling.
  }, [articleId, persist, scrollRef]);

  return progress;
}
