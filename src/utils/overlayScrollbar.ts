/**
 * Overlay scrollbars: keep native scroll chrome hidden until the user is
 * actively scrolling a region, then fade it out shortly after idle.
 *
 * Sets `data-qx-scrolling` on the scroll target (and optional ancestors with
 * `.qx-scroll-area` / ScrollArea roots). CSS in base.css keys off that attribute.
 */

const IDLE_MS = 900;
const ATTR = "data-qx-scrolling";

const idleTimers = new WeakMap<Element, number>();

function markScrolling(el: Element): void {
  el.setAttribute(ATTR, "");
  const existing = idleTimers.get(el);
  if (existing != null) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    el.removeAttribute(ATTR);
    idleTimers.delete(el);
  }, IDLE_MS);
  idleTimers.set(el, timer);
}

function resolveScrollTargets(target: EventTarget | null): Element[] {
  if (!(target instanceof Element)) return [];
  const roots: Element[] = [target];
  // Radix ScrollArea viewport scrolls inside a root wrapper we style separately.
  const scrollAreaRoot = target.closest(".qx-shadcn-scroll-area, [data-qx-scroll-root]");
  if (scrollAreaRoot && scrollAreaRoot !== target) roots.push(scrollAreaRoot);
  return roots;
}

/**
 * Install once per document (main window, float surfaces, etc.).
 * Safe to call multiple times — only the first install sticks per document.
 */
export function installOverlayScrollbars(doc: Document = document): () => void {
  const flag = "__qxOverlayScrollbarsInstalled" as const;
  const root = doc.documentElement as HTMLElement & { [flag]?: boolean };
  if (root[flag]) return () => {};
  root[flag] = true;

  const onScroll = (event: Event) => {
    for (const el of resolveScrollTargets(event.target)) {
      markScrolling(el);
    }
  };

  // capture: scroll does not bubble
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });

  return () => {
    doc.removeEventListener("scroll", onScroll, true);
    root[flag] = false;
  };
}
