import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export interface QxReplyListItem {
  id: string;
  floor: string | number;
  author: string;
  createdAt?: string;
  originalPoster?: boolean;
  body: ReactNode;
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
      {items.map((reply) => (
        <article className="qx-reply-item" key={reply.id}>
          <div className="qx-reply-meta">
            <span className="qx-reply-floor">#{reply.floor}</span>
            <span className="qx-reply-author">{reply.author}</span>
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
