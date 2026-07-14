import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIslandStats } from "../data/hooks";

interface HomeSystemIslandProps {
  showCpu: boolean;
  showGpu: boolean;
  showMemory: boolean;
}

const POINT_COUNT = 24;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function emptyPoints(): number[] {
  return Array.from({ length: POINT_COUNT }, () => 0);
}

/** Tiny inline SVG sparkline (smooth quadratic Bezier) */
function MiniSparkline({ points, color }: { points: number[]; color: string }) {
  const w = 48;
  const h = 14;
  const pad = 1;
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;
  const step = chartW / (points.length - 1);

  const d = useMemo(() => {
    return points
      .map((p, i) => {
        const x = pad + i * step;
        const y = pad + chartH - (clamp(p) / 100) * chartH;
        if (i === 0) return `M${x},${y}`;
        const px = pad + (i - 1) * step;
        const py = pad + chartH - (clamp(points[i - 1]) / 100) * chartH;
        const cx = (px + x) / 2;
        return `Q${cx},${py} ${x},${y}`;
      })
      .join(" ");
  }, [points]);

  return (
    <svg
      className="qx-system-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
    >
      <defs>
        <filter id={`mg-${color.replace("#", "")}`}>
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#mg-${color.replace("#", "")})`}
      />
    </svg>
  );
}

/**
 * System metrics island — data comes from the async bus; first paint shows "--".
 */
export default function HomeSystemIsland({
  showCpu,
  showGpu,
  showMemory,
}: HomeSystemIslandProps) {
  const { stats, ready } = useIslandStats();
  const [cpuPoints, setCpuPoints] = useState<number[]>(emptyPoints);
  const [memPoints, setMemPoints] = useState<number[]>(emptyPoints);

  // Derive sparkline history without blocking — only when stats tick.
  useLayoutEffect(() => {
    if (!stats) return;
    setCpuPoints((cur) => [...cur.slice(1), clamp(stats.cpu)]);
    setMemPoints((cur) => [...cur.slice(1), clamp(stats.memory)]);
  }, [stats]);

  const available = ready && !!stats;
  const cpuText = available ? `${Math.round(stats.cpu)}%` : "--";
  const memText = available ? `${Math.round(stats.memory)}%` : "--";
  const gpuText = !showGpu
    ? null
    : !available
      ? "--"
      : stats.gpu == null
        ? "N/A"
        : `${Math.round(stats.gpu)}%`;

  const marqueeRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = marqueeRef.current;
    if (el) {
      const group = el.firstElementChild;
      if (group) {
        setOverflowing(group.scrollWidth > el.clientWidth);
      }
    }
  }, [cpuText, memText, gpuText, showCpu, showGpu, showMemory]);

  if (!showCpu && !showGpu && !showMemory) return null;

  return (
    <div className="qx-home-system-island" aria-label="System monitor">
      <div
        ref={marqueeRef}
        className={`qx-island-marquee${overflowing ? " is-overflowing" : ""}`}
      >
        {[0, 1].map((copy) => (
          <div className="qx-island-marquee-group" aria-hidden={copy === 1} key={copy}>
            {showCpu && (
              <span className="qx-si-item">
                <span className="qx-si-dot cpu" />
                <span className="qx-si-label">CPU</span>
                <strong className="qx-si-value">{cpuText}</strong>
                <MiniSparkline points={cpuPoints} color="var(--qx-stats-cpu)" />
              </span>
            )}
            {showMemory && (
              <span className="qx-si-item">
                <span className="qx-si-dot mem" />
                <span className="qx-si-label">MEM</span>
                <strong className="qx-si-value">{memText}</strong>
                <MiniSparkline points={memPoints} color="var(--qx-stats-mem)" />
              </span>
            )}
            {showGpu && gpuText !== null && (
              <span className="qx-si-item">
                <span className="qx-si-dot gpu" />
                <span className="qx-si-label">GPU</span>
                <strong className="qx-si-value">{gpuText}</strong>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
