import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../i18n";

export interface QxReplyListItem {
  id: string;
  floor: string | number;
  author: string;
  parentId?: string;
  depth?: number;
  replyToAuthor?: string;
  likeCount?: number;
  createdAt?: string;
  originalPoster?: boolean;
  body: ReactNode;
}

export interface QxReplyTreeRow extends QxReplyListItem {
  treeDepth: number;
  childCount: number;
}

const MAX_REPLY_DEPTH = 8;

/**
 * Resolve a bounded, stable pre-order tree from the shared reply port.
 * Invalid/missing/cyclic parents degrade to roots; paged children may retain a
 * source depth hint without making the renderer trust an unbounded value.
 */
export function buildQxReplyTreeRows(
  items: QxReplyListItem[],
  collapsedIds: ReadonlySet<string> = new Set(),
): QxReplyTreeRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, QxReplyListItem[]>();
  const roots: QxReplyListItem[] = [];
  for (const item of items) {
    const parentId = item.parentId && item.parentId !== item.id && byId.has(item.parentId)
      ? item.parentId
      : undefined;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const siblings = children.get(parentId) || [];
    siblings.push(item);
    children.set(parentId, siblings);
  }

  const rows: QxReplyTreeRow[] = [];
  const visited = new Set<string>();
  const suppressDescendants = (id: string) => {
    for (const child of children.get(id) || []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      suppressDescendants(child.id);
    }
  };
  const append = (item: QxReplyListItem, parentDepth?: number) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const hintedDepth = Number.isFinite(item.depth)
      ? Math.min(MAX_REPLY_DEPTH, Math.max(0, Math.round(Number(item.depth))))
      : 0;
    const treeDepth = parentDepth == null
      ? hintedDepth
      : Math.min(MAX_REPLY_DEPTH, parentDepth + 1);
    const nested = children.get(item.id) || [];
    rows.push({ ...item, treeDepth, childCount: nested.length });
    if (collapsedIds.has(item.id)) {
      suppressDescendants(item.id);
      return;
    }
    for (const child of nested) append(child, treeDepth);
  };
  for (const root of roots) append(root);
  // A parent cycle has no root. Preserve every reply by degrading the first
  // unseen node in source order to a root.
  for (const item of items) append(item);
  return rows;
}

interface QxReplyListProps {
  title: string;
  total?: number;
  items: QxReplyListItem[];
  loading?: boolean;
  loadingText?: string;
  error?: string;
  emptyText?: string;
  originalPosterLabel?: string;
}

/** Shared bottom-of-detail reply surface for built-ins and host Workbench. */
export default function QxReplyList({
  title,
  total,
  items,
  loading = false,
  loadingText = "Loading replies…",
  error,
  emptyText = "No replies yet.",
  originalPosterLabel = "OP",
}: QxReplyListProps) {
  const t = useT();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => buildQxReplyTreeRows(items, collapsedIds), [collapsedIds, items]);
  const displayedTotal = Number.isFinite(total) ? Math.max(0, Number(total)) : items.length;
  return (
    <section className="qx-replies-section" aria-label={title}>
      <div className="qx-replies-header">
        <span>{title}</span>
        <span>{displayedTotal}</span>
      </div>
      {loading ? (
        <div className="qx-replies-status" role="status">
          <LoaderCircle className="qx-loading-spinner" size={13} aria-hidden="true" />
          <span>{loadingText}</span>
        </div>
      ) : null}
      {error ? <div className="qx-replies-status is-error" role="alert">{error}</div> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="qx-replies-status">{emptyText}</div>
      ) : null}
      {rows.map((reply) => (
        <article
          className={`qx-reply-item${reply.treeDepth > 0 ? " is-nested" : ""}`}
          key={reply.id}
          style={{ "--qx-reply-depth": reply.treeDepth } as CSSProperties}
        >
          <div className="qx-reply-meta">
            {reply.childCount > 0 ? (
              <button
                type="button"
                className="qx-reply-thread-toggle"
                aria-expanded={!collapsedIds.has(reply.id)}
                aria-label={collapsedIds.has(reply.id)
                  ? t("plugins.workbench.replies.expand", "Expand thread")
                  : t("plugins.workbench.replies.collapse", "Collapse thread")}
                title={collapsedIds.has(reply.id)
                  ? t("plugins.workbench.replies.expand", "Expand thread")
                  : t("plugins.workbench.replies.collapse", "Collapse thread")}
                onClick={() => setCollapsedIds((current) => {
                  const next = new Set(current);
                  if (next.has(reply.id)) next.delete(reply.id);
                  else next.add(reply.id);
                  return next;
                })}
              >
                {collapsedIds.has(reply.id)
                  ? <ChevronRight size={13} aria-hidden="true" />
                  : <ChevronDown size={13} aria-hidden="true" />}
                <span>{reply.childCount}</span>
              </button>
            ) : null}
            <span className="qx-reply-floor">#{reply.floor}</span>
            <span className="qx-reply-author">{reply.author}</span>
            {reply.replyToAuthor?.trim() ? (
              <span className="qx-reply-target">
                {t("plugins.workbench.replies.replyTo", "Reply to {author}")
                  .replace("{author}", reply.replyToAuthor.trim())}
              </span>
            ) : null}
            {Number(reply.likeCount) > 0 ? (
              <span className="qx-reply-likes">♥ {reply.likeCount}</span>
            ) : null}
            {reply.originalPoster ? (
              <span className="qx-reply-op">{originalPosterLabel}</span>
            ) : null}
            {reply.createdAt ? <span className="qx-reply-time">{reply.createdAt}</span> : null}
          </div>
          <div className="qx-reply-body">{reply.body}</div>
        </article>
      ))}
    </section>
  );
}
