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

export function FeedIcon({ feed }: { feed: RssFeed }) {
  if (feed.icon) {
    return (
      <img
        src={feed.icon}
        alt=""
        style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0 }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <div
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
    >
      {(feed.title || "R").slice(0, 1).toUpperCase()}
    </div>
  );
}