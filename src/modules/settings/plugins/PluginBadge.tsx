import type { ReactNode } from "react";
import { Badge } from "../../../components/ui";

export type PluginBadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export default function PluginBadge({
  children,
  tone = "neutral",
  compact = false,
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: PluginBadgeTone;
  compact?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={[
        "qx-plugin-badge",
        `tone-${tone}`,
        compact ? "is-compact" : "",
        className,
      ].filter(Boolean).join(" ")}
      title={title}
    >
      {children}
    </Badge>
  );
}
