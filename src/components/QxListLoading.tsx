import type { ReactNode } from "react";
import { LoadingLabel, Skeleton } from "./ui";

/**
 * Canonical module list loading state — modeled on V2EX.
 *
 * When to show:
 * - **Empty + loading** → this component (skeleton rows + LoadingLabel).
 * - **Has rows + loading** → keep showing previous rows (stale-while-revalidate);
 *   only Island / section count should hint refresh (e.g. `"..."`).
 * - **Empty + !loading** → `qx-empty-state` message, not this component.
 *
 * Layout matches a typical `qx-list-row`: leading icon, title + subtitle lines,
 * optional trailing meta (badge / time).
 */

export type QxListSkeletonVariant = "default" | "compact" | "tall";

export interface QxListLoadingProps {
  /** Accessible name for the skeleton stack. */
  ariaLabel: string;
  /** Spinner caption under the skeleton (V2EX: "Loading V2EX topics..."). */
  label: ReactNode;
  rows?: number;
  /** Show right-side short skeleton (badge / reply count). Default true. */
  showMeta?: boolean;
  /** Show leading icon placeholder. Default true. */
  showIcon?: boolean;
  variant?: QxListSkeletonVariant;
  className?: string;
}

function rowMinHeight(variant: QxListSkeletonVariant): number | undefined {
  if (variant === "compact") return 28;
  if (variant === "tall") return 56;
  return undefined;
}

/**
 * Skeleton + LoadingLabel block for an empty list that is still fetching.
 */
export function QxListLoading({
  ariaLabel,
  label,
  rows = 6,
  showMeta = true,
  showIcon = true,
  variant = "default",
  className,
}: QxListLoadingProps) {
  const minHeight = rowMinHeight(variant);
  return (
    <>
      <div
        className={["qx-skeleton-stack", "qx-list-loading-stack", className].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        aria-busy="true"
      >
        {Array.from({ length: Math.max(1, rows) }, (_, index) => (
          <div
            className="qx-skeleton-row"
            key={index}
            style={minHeight ? { minHeight } : undefined}
          >
            {showIcon ? <Skeleton className="qx-skeleton-icon" /> : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton className="qx-skeleton-line long" />
              <Skeleton className="qx-skeleton-line medium" style={{ marginTop: 8 }} />
            </div>
            {showMeta ? (
              <Skeleton className="qx-skeleton-line short" style={{ width: 34 }} />
            ) : null}
          </div>
        ))}
      </div>
      <div className="qx-empty-state qx-list-loading-label">
        <LoadingLabel>{label}</LoadingLabel>
      </div>
    </>
  );
}

/**
 * Helper: only render loading UI when the list is empty; if data already exists,
 * callers should keep the list mounted (V2EX refresh behavior).
 */
export function shouldShowQxListLoading(loading: boolean, itemCount: number): boolean {
  return loading && itemCount <= 0;
}
