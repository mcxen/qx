/**
 * One custom overlay scrollbar for every native scroll container.
 *
 * Browser scrollbars stay hidden globally. The active container is measured on
 * scroll and represented by fixed, pointer-transparent thumbs that fade after
 * idle. This keeps ordinary overflow containers and Radix ScrollArea visually
 * identical without wrapping every feature view.
 */

const IDLE_MS = 720;
const ATTR = "data-qx-scrolling";
const MIN_THUMB_PX = 24;
const EDGE_INSET_PX = 2;

interface OverlayState {
  target: HTMLElement | null;
  vertical: HTMLDivElement;
  horizontal: HTMLDivElement;
  idleTimer?: number;
  frame?: number;
}

function createThumb(doc: Document, orientation: "vertical" | "horizontal"): HTMLDivElement {
  const thumb = doc.createElement("div");
  thumb.className = `qx-global-scrollbar is-${orientation}`;
  thumb.setAttribute("aria-hidden", "true");
  doc.body.appendChild(thumb);
  return thumb;
}

function scrollTarget(doc: Document, target: EventTarget | null): HTMLElement | null {
  if (target === doc || target === doc.documentElement || target === doc.body) {
    return doc.scrollingElement instanceof HTMLElement ? doc.scrollingElement : doc.documentElement;
  }
  return target instanceof HTMLElement ? target : null;
}

function hide(state: OverlayState): void {
  state.vertical.classList.remove("is-visible");
  state.horizontal.classList.remove("is-visible");
  state.target?.removeAttribute(ATTR);
  state.target = null;
}

function update(state: OverlayState): void {
  state.frame = undefined;
  const target = state.target;
  if (!target || !target.isConnected) {
    hide(state);
    return;
  }

  const rect = target.getBoundingClientRect();
  const viewportWidth = target.clientWidth;
  const viewportHeight = target.clientHeight;
  const canScrollY = viewportHeight > 0 && target.scrollHeight > viewportHeight + 1;
  const canScrollX = viewportWidth > 0 && target.scrollWidth > viewportWidth + 1;

  if (canScrollY) {
    const trackHeight = Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)) - EDGE_INSET_PX * 2);
    const thumbHeight = Math.max(MIN_THUMB_PX, trackHeight * (viewportHeight / target.scrollHeight));
    const progress = target.scrollTop / Math.max(1, target.scrollHeight - viewportHeight);
    const top = Math.max(EDGE_INSET_PX, rect.top + EDGE_INSET_PX + (trackHeight - thumbHeight) * progress);
    state.vertical.style.left = `${Math.min(window.innerWidth - 4, rect.right - 4)}px`;
    state.vertical.style.top = `${top}px`;
    state.vertical.style.height = `${Math.min(trackHeight, thumbHeight)}px`;
    state.vertical.classList.add("is-visible");
  } else {
    state.vertical.classList.remove("is-visible");
  }

  if (canScrollX) {
    const trackWidth = Math.max(0, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)) - EDGE_INSET_PX * 2);
    const thumbWidth = Math.max(MIN_THUMB_PX, trackWidth * (viewportWidth / target.scrollWidth));
    const progress = target.scrollLeft / Math.max(1, target.scrollWidth - viewportWidth);
    const left = Math.max(EDGE_INSET_PX, rect.left + EDGE_INSET_PX + (trackWidth - thumbWidth) * progress);
    state.horizontal.style.left = `${left}px`;
    state.horizontal.style.top = `${Math.min(window.innerHeight - 4, rect.bottom - 4)}px`;
    state.horizontal.style.width = `${Math.min(trackWidth, thumbWidth)}px`;
    state.horizontal.classList.add("is-visible");
  } else {
    state.horizontal.classList.remove("is-visible");
  }
}

function scheduleUpdate(state: OverlayState): void {
  if (state.frame != null) return;
  state.frame = window.requestAnimationFrame(() => update(state));
}

/** Install once per document. Safe for the main window and auxiliary surfaces. */
export function installOverlayScrollbars(doc: Document = document): () => void {
  const flag = "__qxOverlayScrollbarsInstalled" as const;
  const root = doc.documentElement as HTMLElement & { [flag]?: boolean };
  if (root[flag] || !doc.body) return () => {};
  root[flag] = true;

  const state: OverlayState = {
    target: null,
    vertical: createThumb(doc, "vertical"),
    horizontal: createThumb(doc, "horizontal"),
  };

  const onScroll = (event: Event) => {
    const next = scrollTarget(doc, event.target);
    if (!next) return;
    if (state.target && state.target !== next) state.target.removeAttribute(ATTR);
    state.target = next;
    next.setAttribute(ATTR, "");
    if (state.idleTimer != null) window.clearTimeout(state.idleTimer);
    scheduleUpdate(state);
    state.idleTimer = window.setTimeout(() => hide(state), IDLE_MS);
  };
  const onViewportChange = () => scheduleUpdate(state);

  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onViewportChange, { passive: true });

  return () => {
    doc.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onViewportChange);
    if (state.idleTimer != null) window.clearTimeout(state.idleTimer);
    if (state.frame != null) window.cancelAnimationFrame(state.frame);
    state.vertical.remove();
    state.horizontal.remove();
    root[flag] = false;
  };
}

/** Same behavior for sandboxed plugin srcdoc documents. */
export const PLUGIN_OVERLAY_SCROLLBAR_RUNTIME_JS = `
(() => {
  const idleMs = 720;
  let target = null;
  let timer = 0;
  let frame = 0;
  const make = (kind) => {
    const el = document.createElement('div');
    el.className = 'qx-plugin-scrollbar is-' + kind;
    document.body.appendChild(el);
    return el;
  };
  const vertical = make('vertical');
  const horizontal = make('horizontal');
  const hide = () => { vertical.classList.remove('is-visible'); horizontal.classList.remove('is-visible'); };
  const paint = () => {
    frame = 0;
    if (!target || !target.isConnected) return hide();
    const r = target.getBoundingClientRect();
    const h = target.clientHeight;
    const w = target.clientWidth;
    if (h > 0 && target.scrollHeight > h + 1) {
      const track = Math.max(0, Math.min(r.height, innerHeight - Math.max(0, r.top)) - 4);
      const size = Math.max(24, track * h / target.scrollHeight);
      const p = target.scrollTop / Math.max(1, target.scrollHeight - h);
      Object.assign(vertical.style, { left: Math.min(innerWidth - 4, r.right - 4) + 'px', top: Math.max(2, r.top + 2 + (track - size) * p) + 'px', height: Math.min(track, size) + 'px' });
      vertical.classList.add('is-visible');
    } else vertical.classList.remove('is-visible');
    if (w > 0 && target.scrollWidth > w + 1) {
      const track = Math.max(0, Math.min(r.width, innerWidth - Math.max(0, r.left)) - 4);
      const size = Math.max(24, track * w / target.scrollWidth);
      const p = target.scrollLeft / Math.max(1, target.scrollWidth - w);
      Object.assign(horizontal.style, { left: Math.max(2, r.left + 2 + (track - size) * p) + 'px', top: Math.min(innerHeight - 4, r.bottom - 4) + 'px', width: Math.min(track, size) + 'px' });
      horizontal.classList.add('is-visible');
    } else horizontal.classList.remove('is-visible');
  };
  document.addEventListener('scroll', (event) => {
    target = event.target === document ? document.scrollingElement : event.target;
    clearTimeout(timer);
    if (!frame) frame = requestAnimationFrame(paint);
    timer = setTimeout(hide, idleMs);
  }, { capture: true, passive: true });
})();`;
