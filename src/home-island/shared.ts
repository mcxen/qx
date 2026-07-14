export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Human rate for bytes/sec — compact HUD style. */
export function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return "0";
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(bytesPerSec < 10 * 1024 ? 1 : 0)}K`;
  if (bytesPerSec < 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(bytesPerSec < 10 * 1024 * 1024 ? 1 : 0)}M`;
  }
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/** Rolling history for VU bars (0..1). */
export function pushLevel(history: number[], next: number, max = 12): number[] {
  return [...history.slice(-(max - 1)), clamp01(next)];
}

/** Map absolute rate (B/s) to 0..1 with soft log scale for sci-fi bars. */
export function rateToLevel(bytesPerSec: number): number {
  if (bytesPerSec <= 0) return 0;
  // ~1KB → 0.2, ~100KB → 0.5, ~10MB → 0.85
  const level = Math.log10(bytesPerSec + 1) / Math.log10(10_000_000);
  return clamp01(level);
}
