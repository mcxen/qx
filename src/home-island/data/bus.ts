import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime, pushLevel, rateToLevel } from "../shared";
import type {
  IslandDataChannel,
  IslandDataListener,
  IslandDataState,
  NetSnapshot,
  PowerSnapshot,
  SystemStatsSnapshot,
} from "./types";

const INTERVAL_MS: Record<IslandDataChannel, number> = {
  stats: 1600,
  power: 4000,
  net: 1200,
};

const emptyReady = (): Record<IslandDataChannel, boolean> => ({
  stats: false,
  power: false,
  net: false,
});

const emptyError = (): Record<IslandDataChannel, string | null> => ({
  stats: null,
  power: null,
  net: null,
});

function createInitialState(): IslandDataState {
  return {
    stats: null,
    power: null,
    net: null,
    ready: emptyReady(),
    error: emptyError(),
  };
}

type Interest = Record<IslandDataChannel, number>;

function emptyInterest(): Interest {
  return { stats: 0, power: 0, net: 0 };
}

/**
 * Background island metrics bus.
 * - Never blocks React render: samples are scheduled idle / on timers.
 * - Interest-counted: only active channels are polled.
 * - Pauses while the document is hidden.
 * - Overlapping samples are skipped (in-flight guard).
 */
class HomeIslandDataBus {
  private state: IslandDataState = createInitialState();
  private listeners = new Set<IslandDataListener>();
  private interest = emptyInterest();
  private timers: Partial<Record<IslandDataChannel, ReturnType<typeof setInterval>>> = {};
  private inFlight: Partial<Record<IslandDataChannel, boolean>> = {};
  private generation = 0;
  private netPrev: { in: number; out: number; t: number } | null = null;
  private visibilityBound = false;
  private idleHandle: number | null = null;

  getState(): IslandDataState {
    return this.state;
  }

  subscribe(channels: IslandDataChannel[], listener: IslandDataListener): () => void {
    for (const ch of channels) this.interest[ch] += 1;
    this.listeners.add(listener);
    listener(this.state);
    this.ensureVisibilityHook();
    this.reconcilePollers();
    // Kick samples off the critical path so mounting the island never stalls paint.
    this.scheduleIdleSample(channels);

    return () => {
      this.listeners.delete(listener);
      for (const ch of channels) {
        this.interest[ch] = Math.max(0, this.interest[ch] - 1);
      }
      this.reconcilePollers();
    };
  }

  private ensureVisibilityHook(): void {
    if (this.visibilityBound || typeof document === "undefined") return;
    this.visibilityBound = true;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = (): void => {
    this.reconcilePollers();
    if (!document.hidden) {
      const active = (Object.keys(this.interest) as IslandDataChannel[]).filter(
        (ch) => this.interest[ch] > 0,
      );
      this.scheduleIdleSample(active);
    }
  };

  private reconcilePollers(): void {
    const hidden = typeof document !== "undefined" && document.hidden;
    for (const ch of Object.keys(INTERVAL_MS) as IslandDataChannel[]) {
      const want = !hidden && this.interest[ch] > 0;
      const has = this.timers[ch] !== undefined;
      if (want && !has) {
        this.timers[ch] = setInterval(() => {
          void this.sample(ch);
        }, INTERVAL_MS[ch]);
      } else if (!want && has) {
        clearInterval(this.timers[ch]);
        delete this.timers[ch];
      }
    }
  }

  private scheduleIdleSample(channels: IslandDataChannel[]): void {
    if (channels.length === 0) return;
    const run = () => {
      this.idleHandle = null;
      for (const ch of channels) {
        if (this.interest[ch] > 0) void this.sample(ch);
      }
    };

    if (typeof window === "undefined") {
      void run();
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      if (this.idleHandle != null) {
        idleWindow.cancelIdleCallback?.(this.idleHandle);
      }
      this.idleHandle = idleWindow.requestIdleCallback(run, { timeout: 600 });
      return;
    }

    // Fallback: defer past current frame so paint is never blocked.
    setTimeout(run, 0);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private patch(partial: Partial<IslandDataState>): void {
    this.state = {
      ...this.state,
      ...partial,
      ready: partial.ready ? { ...this.state.ready, ...partial.ready } : this.state.ready,
      error: partial.error ? { ...this.state.error, ...partial.error } : this.state.error,
    };
    this.emit();
  }

  private async sample(channel: IslandDataChannel): Promise<void> {
    if (!isTauriRuntime()) {
      this.patch({
        error: { ...this.state.error, [channel]: "unavailable" },
        ready: { ...this.state.ready, [channel]: false },
      });
      return;
    }
    if (this.inFlight[channel]) return;
    if (this.interest[channel] <= 0) return;
    if (typeof document !== "undefined" && document.hidden) return;

    this.inFlight[channel] = true;
    const gen = this.generation;
    try {
      if (channel === "stats") {
        const raw = await invoke<{
          cpu: number;
          memory: number;
          memory_used_gb: number;
          memory_total_gb: number;
          gpu: number | null;
        }>("get_system_stats");
        if (gen !== this.generation || this.interest.stats <= 0) return;
        const stats: SystemStatsSnapshot = {
          cpu: raw.cpu,
          memory: raw.memory,
          memoryUsedGb: raw.memory_used_gb,
          memoryTotalGb: raw.memory_total_gb,
          gpu: raw.gpu,
        };
        this.patch({
          stats,
          ready: { ...this.state.ready, stats: true },
          error: { ...this.state.error, stats: null },
        });
        return;
      }

      if (channel === "power") {
        const raw = await invoke<{
          batteryLevel: number | null;
          isCharging: boolean;
          fullyCharged: boolean;
          source: string;
        }>("qx_system_monitor_power");
        if (gen !== this.generation || this.interest.power <= 0) return;
        const power: PowerSnapshot = {
          batteryLevel: raw.batteryLevel,
          isCharging: raw.isCharging,
          fullyCharged: raw.fullyCharged,
          source: raw.source,
        };
        this.patch({
          power,
          ready: { ...this.state.ready, power: true },
          error: { ...this.state.error, power: null },
        });
        return;
      }

      // net
      const counters = await invoke<{ totalBytesIn: number; totalBytesOut: number }>(
        "qx_system_monitor_network_counters",
      );
      if (gen !== this.generation || this.interest.net <= 0) return;
      const now = performance.now();
      const bytesIn = Number(counters.totalBytesIn) || 0;
      const bytesOut = Number(counters.totalBytesOut) || 0;
      let net: NetSnapshot = this.state.net ?? {
        downRate: 0,
        upRate: 0,
        downLevels: Array(12).fill(0),
        upLevels: Array(12).fill(0),
      };
      if (this.netPrev) {
        const dt = Math.max(0.2, (now - this.netPrev.t) / 1000);
        const down = Math.max(0, (bytesIn - this.netPrev.in) / dt);
        const up = Math.max(0, (bytesOut - this.netPrev.out) / dt);
        net = {
          downRate: down,
          upRate: up,
          downLevels: pushLevel(net.downLevels, rateToLevel(down)),
          upLevels: pushLevel(net.upLevels, rateToLevel(up)),
        };
      }
      this.netPrev = { in: bytesIn, out: bytesOut, t: now };
      this.patch({
        net,
        ready: { ...this.state.ready, net: true },
        error: { ...this.state.error, net: null },
      });
    } catch (error) {
      if (gen !== this.generation) return;
      const message = error instanceof Error ? error.message : String(error || "failed");
      this.patch({
        error: { ...this.state.error, [channel]: message },
      });
    } finally {
      this.inFlight[channel] = false;
    }
  }
}

export const homeIslandDataBus = new HomeIslandDataBus();
