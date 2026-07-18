import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

export type QxLoadingMarkVariant = "sync" | "cascade" | "flip" | "pulse";

export interface QxLoadingMarkProps {
  variant?: QxLoadingMarkVariant;
  size?: number;
  speed?: number;
  active?: boolean;
  label?: string;
  className?: string;
}

const TILES = [
  {
    d: "M35 102Q35.8 98 40 98H69Q73.5 98 72.6 102L67 132Q66.2 136 62 136H33Q28.5 136 29.4 132Z",
    delay: 0,
  },
  {
    d: "M66 64Q66.8 60 71 60H108Q112.5 60 111.6 64L104.5 102Q103.7 106 99.5 106H84L86 95Q86.8 91 82.6 91H62Q57.5 91 58.4 87Z",
    delay: 0.13,
  },
  {
    d: "M94 20Q94.8 16 99 16H143Q147.5 16 146.6 20L137.5 70Q136.7 74 132.5 74H108L112 53Q112.8 49 108.6 49H86Q81.5 49 82.4 45Z",
    delay: 0.26,
  },
] as const;

function tileAnimation(variant: QxLoadingMarkVariant) {
  switch (variant) {
    case "cascade":
      return { rotate: [0, 0, 90, 90, 180, 180, 270, 270, 360] };
    case "flip":
      return { rotateY: [0, 0, 180, 180, 360], scale: [1, 1, 0.94, 1, 1] };
    case "pulse":
      return { rotate: [0, 12, 0, -12, 0], scale: [0.96, 1.04, 0.98, 1.04, 0.96] };
    default:
      return { rotate: 360 };
  }
}

/**
 * Animated Qx brand loader. Variants share one SVG so future motion studies can
 * change timing without duplicating the mark or its accessibility contract.
 */
export default function QxLoadingMark({
  variant = "cascade",
  size = 160,
  speed = 1,
  active = true,
  label = "Loading",
  className,
}: QxLoadingMarkProps) {
  const reducedMotion = useReducedMotion();
  const filterId = `qx-loading-glow-${useId().replace(/:/g, "")}`;
  const gradientId = `qx-loading-gradient-${useId().replace(/:/g, "")}`;
  const shouldAnimate = active && !reducedMotion;
  const duration = (variant === "sync" ? 1.8 : 2.2) / Math.max(0.25, speed);

  return (
    <svg
      className={["qx-loading-mark", `is-${variant}`, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 160 160"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--qx-blue-900)" />
          <stop offset="1" stopColor="var(--qx-accent)" />
        </linearGradient>
        <filter id={filterId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      <motion.ellipse
        className="qx-loading-mark__halo qx-loading-mark__halo--wide"
        cx="82"
        cy="79"
        rx="61"
        ry="57"
        filter={`url(#${filterId})`}
        animate={shouldAnimate ? { opacity: [0.1, 0.34, 0.1], scale: [0.82, 1.08, 0.82] } : undefined}
        transition={{ duration: duration * 1.15, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.ellipse
        className="qx-loading-mark__halo"
        cx="85"
        cy="76"
        rx="38"
        ry="36"
        filter={`url(#${filterId})`}
        animate={shouldAnimate ? { opacity: [0.16, 0.48, 0.16], scale: [0.72, 1.12, 0.72] } : undefined}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: 0.12 }}
      />

      {TILES.map((tile) => (
        <motion.path
          key={tile.d}
          className="qx-loading-mark__tile"
          d={tile.d}
          fill={`url(#${gradientId})`}
          animate={shouldAnimate ? tileAnimation(variant) : undefined}
          transition={{
            duration,
            repeat: Infinity,
            ease: variant === "cascade" ? [0.65, 0, 0.35, 1] : "easeInOut",
            delay: variant === "sync" ? 0 : tile.delay / Math.max(0.25, speed),
            times: variant === "cascade" ? [0, 0.12, 0.24, 0.37, 0.49, 0.62, 0.74, 0.87, 1] : undefined,
          }}
          style={{ transformOrigin: "center", transformBox: "fill-box" }}
        />
      ))}
    </svg>
  );
}
