export interface AppEntry {
  name: string;
  display_name?: string;
  /** Optional list subtitle (module surfaces, clipboard preview, etc.). */
  subtitle?: string;
  path: string;
  icon: string;
  kind?: "app" | "command" | "clipboard" | "file" | "folder" | "calculation";
  /** Built-in module owner for availability/maturity presentation. */
  moduleId?: string;
  /** Optional precomputed match tier for launcher ranking (lower = better). */
  matchScore?: number;
  /** Rolling 30-day open count for this path. */
  clickCount?: number;
  /** Unix modification time in seconds for file/folder search results. */
  modified_at?: number;
}

export interface SearchHistoryEntry {
  id: number;
  query: string;
  timestamp: string;
}
