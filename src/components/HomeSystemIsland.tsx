import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

interface HomeSystemIslandProps {
  showCpu: boolean;
  showGpu: boolean;
  showMemory: boolean;
}

interface SystemStats {
  cpu: number;
  memory: number;
  memory_used_gb: number;
  memory_total_gb: number;
  gpu: number | null;
}

const POINT_COUNT = 24;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function emptyPoints(): number[] {
  return Array.from({ length: POINT_COUNT }, () => 0);
}

function TrendDots({ points }: { points: number[] }) {
  return (
    <div className="qx-system-trend" aria-hidden="true">
      {points.map((point, index) => (
        <span
          key={index}
          style={{
            transform: `translateY(${Math.round((100 - point) * 0.18)}px)`,
            opacity: point <= 0 ? 0.18 : 0.35 + point / 180,
          }}
        />
      ))}
    </div>
  );
}

export default function HomeSystemIsland({
  showCpu,
  showGpu,
  showMemory,
}: HomeSystemIslandProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [points, setPoints] = useState<number[]>(emptyPoints);
  const [available, setAvailable] = useState(isTauriRuntime());

  useEffect(() => {
    let cancelled = false;

    const sample = async () => {
      if (!isTauriRuntime()) {
        setAvailable(false);
        return;
      }
      try {
        const next = await invoke<SystemStats>("get_system_stats");
        if (cancelled) return;
        setAvailable(true);
        setStats(next);
        setPoints((current) => [...current.slice(1), clamp(next.cpu)]);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    };

    void sample();
    const timer = window.setInterval(sample, 1600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const cpuText = stats && available ? `${Math.round(stats.cpu)}%` : "--";
  const memText = stats && available
    ? `${Math.round(stats.memory)}%`
    : "--";
  const memDetail = stats && available
    ? `${stats.memory_used_gb.toFixed(1)}/${stats.memory_total_gb.toFixed(0)}GB`
    : "runtime";
  const gpuText = useMemo(() => {
    if (!showGpu) return null;
    if (!available) return "--";
    return stats?.gpu == null ? "N/A" : `${Math.round(stats.gpu)}%`;
  }, [available, showGpu, stats?.gpu]);

  if (!showCpu && !showGpu && !showMemory) return null;

  return (
    <div className="qx-home-system-island" aria-label="System monitor">
      <div className="qx-system-main">
        <div className="qx-system-main-head">
          <span className="qx-system-status-dot" aria-hidden="true" />
          <span className="qx-system-title">{showCpu ? "CPU" : "SYS"}</span>
          <strong>{showCpu ? cpuText : available ? "LIVE" : "--"}</strong>
        </div>
        <TrendDots points={showCpu ? points : emptyPoints()} />
      </div>

      <div className="qx-system-side">
        {showMemory && (
          <div className="qx-system-side-row">
            <span>MEM</span>
            <strong>{memText}</strong>
            <small>{memDetail}</small>
          </div>
        )}
        {showGpu && (
          <div className="qx-system-side-row">
            <span>GPU</span>
            <strong>{gpuText}</strong>
            <small>{stats?.gpu == null ? "unavailable" : "active"}</small>
          </div>
        )}
      </div>
    </div>
  );
}
