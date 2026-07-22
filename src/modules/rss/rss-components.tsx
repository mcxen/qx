import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { RssFeed } from "./store";

export function formatRelative(ts: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function letterFor(feed: RssFeed): string {
  return (feed.title || feed.url || "R").trim().slice(0, 1).toUpperCase() || "R";
}

function LetterAvatar({ feed }: { feed: RssFeed }) {
  return (
    <div
      className="qx-rss-feed-icon-letter"
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        background: "var(--qx-overlay-1)",
        color: "var(--qx-text-secondary)",
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      aria-hidden
    >
      {letterFor(feed)}
    </div>
  );
}

/** Feed list avatar: remote favicon when available, letter fallback on error. */
export function FeedIcon({ feed, showImage = true }: { feed: RssFeed; showImage?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = (feed.icon || "").trim();
  const imageSrc = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(src) ? convertFileSrc(src) : src;

  useEffect(() => setFailed(false), [src]);

  if (!showImage || !src || failed) {
    return <LetterAvatar feed={feed} />;
  }

  return (
    <img
      className="qx-rss-feed-icon"
      src={imageSrc}
      alt=""
      width={22}
      height={22}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        flexShrink: 0,
        objectFit: "contain",
        background: "var(--qx-overlay-1)",
      }}
      onError={() => setFailed(true)}
    />
  );
}
