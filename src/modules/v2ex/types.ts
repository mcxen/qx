export type V2exMode = "latest" | "hot";

export interface V2exTopic {
  id: number;
  title: string;
  url: string;
  node: string;
  author: string;
  replies: number;
  created: number;
  content: string;
  last_modified: number;
}

export interface V2exReply {
  id: number;
  content: string;
  author: string;
  created: number;
  floor: number;
}

export function formatTime(seconds: number): string {
  if (!seconds) return "unknown";
  const date = new Date(seconds * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
