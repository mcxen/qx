/**
 * Clipboard open session port (core module — highest open priority).
 *
 * Hot/cold history (Raycast-style):
 * - Hot: first page of recent + pinned rows → store for instant paint / SWR.
 * - Cold: older retained rows stay on disk; load when the list scrolls to the end
 *   (or keyboard selection nears the bottom).
 *
 * The panel is eagerly bundled with the host. This port warms the hot window so
 * shortcut / navigate can paint rows with data already in the store.
 */
import { invoke } from "@tauri-apps/api/core";
import { useStore, type ClipboardEntry } from "../../store";

/** First paint / open prefetch window. */
export const CLIPBOARD_HOT_LIMIT = 80;
/** Older history page size when scrolling into cold storage. */
export const CLIPBOARD_COLD_PAGE = 50;

/** @deprecated Use CLIPBOARD_HOT_LIMIT — kept for call sites that only need a hot window. */
export const CLIPBOARD_HISTORY_LIMIT = CLIPBOARD_HOT_LIMIT;

export interface ClipboardHistoryCursor {
  before_timestamp: string;
  before_id: string;
  before_pinned: number;
}

export interface ClipboardHistoryPage {
  items: ClipboardEntry[];
  has_more: boolean;
  next_before_timestamp?: string | null;
  next_before_id?: string | null;
  next_before_pinned?: number | null;
}

export interface ClipboardHistorySession {
  items: ClipboardEntry[];
  hasMore: boolean;
  cursor: ClipboardHistoryCursor | null;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let historyInFlight: Promise<ClipboardHistorySession> | null = null;
let openInFlight: Promise<ClipboardHistorySession> | null = null;
let moreInFlight: Promise<ClipboardHistorySession> | null = null;

/** Session cursor for cold load-more (module panel + event refresh share this). */
let sessionCursor: ClipboardHistoryCursor | null = null;
let sessionHasMore = false;
/**
 * True after at least one cold page was appended. Hot refresh then merges the
 * new head with the already-loaded older tail instead of wiping the list.
 */
let sessionLoadedCold = false;
/** Active server-side search string for paged reads (empty = full history). */
let sessionQuery = "";

function cursorFromPage(page: ClipboardHistoryPage): ClipboardHistoryCursor | null {
  if (
    !page.next_before_timestamp ||
    !page.next_before_id ||
    page.next_before_pinned === undefined ||
    page.next_before_pinned === null
  ) {
    return null;
  }
  return {
    before_timestamp: page.next_before_timestamp,
    before_id: page.next_before_id,
    before_pinned: page.next_before_pinned,
  };
}

function cursorFromLastItem(item: ClipboardEntry | undefined): ClipboardHistoryCursor | null {
  if (!item) return null;
  return {
    before_timestamp: item.timestamp,
    before_id: item.id,
    before_pinned: item.pinned ? 1 : 0,
  };
}

/**
 * Keep already-scrolled cold rows when the hot window is refreshed (new copy).
 * Drops any cold id that reappeared in hot (timestamp bump / re-copy).
 */
function mergeHotWithColdTail(
  hot: ClipboardEntry[],
  existing: ClipboardEntry[],
): ClipboardEntry[] {
  if (existing.length === 0) return hot;
  const hotIds = new Set(hot.map((item) => item.id));
  const coldTail = existing.filter((item) => !hotIds.has(item.id));
  return coldTail.length === 0 ? hot : [...hot, ...coldTail];
}

async function fetchHistoryPage(options: {
  limit: number;
  cursor?: ClipboardHistoryCursor | null;
  query?: string;
}): Promise<ClipboardHistoryPage> {
  return invoke<ClipboardHistoryPage>("get_clipboard_history_page", {
    limit: options.limit,
    beforeTimestamp: options.cursor?.before_timestamp ?? null,
    beforeId: options.cursor?.before_id ?? null,
    beforePinned: options.cursor?.before_pinned ?? null,
    query: options.query?.trim() ? options.query.trim() : null,
  });
}

function applyHotPage(page: ClipboardHistoryPage, preserveCold: boolean): ClipboardHistorySession {
  const store = useStore.getState();
  let items: ClipboardEntry[];

  if (preserveCold && sessionLoadedCold) {
    items = mergeHotWithColdTail(page.items, store.clipboardHistory);
    // Continue cold paging from the end of the merged list.
    sessionCursor = cursorFromLastItem(items[items.length - 1]);
    // If the hot window itself is not full-store, more rows may exist past the tail.
    // When we already exhausted cold (has_more false), keep it false unless hot grew.
    if (page.has_more) {
      sessionHasMore = true;
    }
    // If hot says no more, the full store fits in the hot window → nothing older.
    if (!page.has_more) {
      sessionHasMore = false;
      sessionLoadedCold = false;
      items = page.items;
      sessionCursor = cursorFromPage(page);
    }
  } else {
    items = page.items;
    sessionCursor = cursorFromPage(page);
    sessionHasMore = page.has_more;
    sessionLoadedCold = false;
  }

  store.setClipboardHistory(items);
  return { items, hasMore: sessionHasMore, cursor: sessionCursor };
}

function applyColdPage(page: ClipboardHistoryPage): ClipboardHistorySession {
  const store = useStore.getState();
  const existing = store.clipboardHistory;
  const seen = new Set(existing.map((item) => item.id));
  const appended = page.items.filter((item) => !seen.has(item.id));
  const items = appended.length === 0 ? existing : [...existing, ...appended];
  if (appended.length > 0) sessionLoadedCold = true;
  sessionCursor = cursorFromPage(page);
  sessionHasMore = page.has_more;
  store.setClipboardHistory(items);
  return { items, hasMore: sessionHasMore, cursor: sessionCursor };
}

/**
 * Fetch the hot history window into the app store.
 * Concurrent callers join one IPC. Preserves already-loaded cold rows when possible.
 */
export function refreshClipboardHistory(options?: {
  /** When set, restarts pagination under a server-side text search. */
  query?: string;
  /** Drop cold tail and reset session (open path / search change). */
  reset?: boolean;
}): Promise<ClipboardHistorySession> {
  if (historyInFlight) return historyInFlight;
  if (!isTauriRuntime()) {
    return Promise.resolve({
      items: useStore.getState().clipboardHistory,
      hasMore: false,
      cursor: null,
    });
  }

  const reset = options?.reset === true;
  if (options?.query !== undefined) {
    const nextQuery = options.query.trim();
    if (nextQuery !== sessionQuery) {
      sessionQuery = nextQuery;
      sessionLoadedCold = false;
      sessionCursor = null;
      sessionHasMore = false;
    }
  }
  if (reset) {
    sessionLoadedCold = false;
    sessionCursor = null;
    sessionHasMore = false;
    if (options?.query === undefined) {
      // Open/warm without an explicit query clears search scoping.
      sessionQuery = "";
    }
  }

  const preserveCold = !reset && sessionLoadedCold;

  historyInFlight = (async () => {
    try {
      const page = await fetchHistoryPage({
        limit: CLIPBOARD_HOT_LIMIT,
        query: sessionQuery,
      });
      return applyHotPage(page, preserveCold);
    } catch {
      return {
        items: useStore.getState().clipboardHistory,
        hasMore: sessionHasMore,
        cursor: sessionCursor,
      };
    } finally {
      historyInFlight = null;
    }
  })();
  return historyInFlight;
}

/**
 * Load the next cold page (older retained history) and append to the store.
 * No-op when nothing more remains or a load is already in flight.
 */
export function loadMoreClipboardHistory(): Promise<ClipboardHistorySession> {
  if (moreInFlight) return moreInFlight;
  if (!sessionHasMore || !sessionCursor) {
    return Promise.resolve({
      items: useStore.getState().clipboardHistory,
      hasMore: false,
      cursor: sessionCursor,
    });
  }
  if (!isTauriRuntime()) {
    return Promise.resolve({
      items: useStore.getState().clipboardHistory,
      hasMore: false,
      cursor: null,
    });
  }

  const cursor = sessionCursor;
  moreInFlight = (async () => {
    try {
      const page = await fetchHistoryPage({
        limit: CLIPBOARD_COLD_PAGE,
        cursor,
        query: sessionQuery,
      });
      return applyColdPage(page);
    } catch {
      return {
        items: useStore.getState().clipboardHistory,
        hasMore: sessionHasMore,
        cursor: sessionCursor,
      };
    } finally {
      moreInFlight = null;
    }
  })();
  return moreInFlight;
}

export function getClipboardHistorySession(): ClipboardHistorySession {
  return {
    items: useStore.getState().clipboardHistory,
    hasMore: sessionHasMore,
    cursor: sessionCursor,
  };
}

export interface PrefetchClipboardOpenOptions {
  /**
   * When true (default on panel open), also probe the live system clipboard for
   * an image and re-fetch history if a new entry was saved.
   * Idle warm-up should pass false so background prefetch has no side effects.
   */
  captureLiveImage?: boolean;
}

/**
 * Warm history as soon as clipboard is requested. Safe from navigate, idle
 * warm, and ClipboardPanel mount — callers share in-flight work.
 */
export function prefetchClipboardOpen(
  options: PrefetchClipboardOpenOptions = {},
): Promise<ClipboardHistorySession> {
  const captureLiveImage = options.captureLiveImage !== false;

  if (!captureLiveImage) {
    return refreshClipboardHistory({ reset: true });
  }

  if (openInFlight) return openInFlight;
  if (!isTauriRuntime()) {
    return Promise.resolve({
      items: useStore.getState().clipboardHistory,
      hasMore: false,
      cursor: null,
    });
  }

  openInFlight = (async () => {
    try {
      // History and live-image capture run concurrently. If capture inserts a
      // row, refresh once more so the new image is in the store before settle.
      const historyPromise = refreshClipboardHistory({ reset: true });
      const imagePromise = invoke<unknown>("read_clipboard_image_now")
        .then((saved) => Boolean(saved))
        .catch(() => false);
      const [, saved] = await Promise.all([historyPromise, imagePromise]);
      if (saved) return refreshClipboardHistory({ reset: true });
      return getClipboardHistorySession();
    } finally {
      openInFlight = null;
    }
  })();
  return openInFlight;
}
