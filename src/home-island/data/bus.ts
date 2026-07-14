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
  stats: 1500,
  power: 3500,
  net: 1000,
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
 * - Pauses while the document is hidden (panel fully hidden).
 * - On re-show / re-subscribe: kick samples immediately (timers alone can stall).
 * - Overlapping samples are skipped (in-flight guard).
 * - CPU needs two host samples — first call warms the baseline.
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
  private focusBound = false;
  private idleHandle: number | null = null;
  private kickTimers: ReturnType<typeof setTimeout>[] = [];

  getState(): IslandDataState {
    return this.state;
  }

  /** Force fresh samples for all interested channels (panel shown / settings open). */
  kick(channels?: IslandDataChannel[]): void {
    const list =
      channels
      ?? (Object.keys(this.interest) as IslandDataChannel[]).filter((ch) => this.interest[ch] > 0);
    if (list.length === 0) return;
    this.reconcilePollers();
    for (const ch of list) {
      void this.sample(ch, { force: true });
    }
    // Second wave: CPU / net rates need a follow-up delta after a short gap.
    this.clearKickTimers();
    this.kickTimers.push(
      setTimeout(() => {
        for (const ch of list) {
          if (this.interest[ch] > 0) void this.sample(ch, { force: true });
        }
      }, 280),
    );
    this.kickTimers.push(
      setTimeout(() => {
        for (const ch of list) {
          if (this.interest[ch] > 0) void this.sample(ch, { force: true });
        }
      }, 900),
    );
  }

  subscribe(channels: IslandDataChannel[], listener: IslandDataListener): () => void {
    for (const ch of channels) this.interest[ch] += 1;
    this.listeners.add(listener);
    listener(this.state);
    this.ensureVisibilityHook();
    this.ensureFocusHook();
    this.reconcilePollers();
    // Immediate path + idle path so first paint isn't stuck on "--" forever.
    this.kick(channels);
    this.scheduleIdleSample(channels);

    return () => {
      this.listeners.delete(listener);
      for (const ch of channels) {
        this.interest[ch] = Math.max(0, this.interest[ch] - 1);
      }
      this.reconcilePollers();
    };
  }

  private clearKickTimers(): void {
    for (const t of this.kickTimers) clearTimeout(t);
    this.kickTimers = [];
  }

  private ensureVisibilityHook(): void {
    if (this.visibilityBound || typeof document === "undefined") return;
    this.visibilityBound = true;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private ensureFocusHook(): void {
    if (this.focusBound || typeof window === "undefined") return;
    this.focusBound = true;
    // Floating panel show often restores focus without a clean visibility flip
    // after WebView timer throttling — kick metrics when we become active again.
    window.addEventListener("focus", this.onWindowFocus);
    document.addEventListener("focusin", this.onWindowFocus);
  }

  private onVisibility = (): void => {
    this.reconcilePollers();
    if (!document.hidden) {
      const active = (Object.keys(this.interest) as IslandDataChannel[]).filter(
        (ch) => this.interest[ch] > 0,
      );
      this.kick(active);
    }
  };

  private onWindowFocus = (): void => {
    if (typeof document !== "undefined" && document.hidden) return;
    const active = (Object.keys(this.interest) as IslandDataChannel[]).filter(
      (ch) => this.interest[ch] > 0,
    );
    if (active.length > 0) this.kick(active);
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
      this.idleHandle = idleWindow.requestIdleCallback(run, { timeout: 400 });
      return;
    }

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

  private async sample(
    channel: IslandDataChannel,
    opts?: { force?: boolean },
  ): Promise<void> {
    if (!isTauriRuntime()) {
      this.patch({
        error: { ...this.state.error, [channel]: "unavailable" },
        ready: { ...this.state.ready, [channel]: false },
      });
      return;
    }
    if (this.inFlight[channel] && !opts?.force) return;
    if (this.interest[channel] <= 0) return;
    // Still allow forced kick even if briefly hidden during space switch.
    if (!opts?.force && typeof document !== "undefined" && document.hidden) return;
    if (this.inFlight[channel]) return;

    this.inFlight[channel] = true;
    const gen = this.generation;
    try {
      if (channel === "stats") {
        // First host_processor_info sample only seeds the baseline (often 0%).
        // Always take a short follow-up so the UI gets a real delta quickly.
        const read = () =>
          invoke<{
            cpu: number;
            memory: number;
            memory_used_gb: number;
            memory_total_gb: number;
            gpu: number | null;
          }>("get_system_stats");

        let raw = await read();
        if (gen !== this.generation || this.interest.stats <= 0) return;
        // Warm baseline when cpu is still 0 and we have no prior sample.
        if ((!this.state.stats || this.state.stats.cpu === 0) && raw.cpu === 0) {
          await new Promise((r) => setTimeout(r, 220));
          if (gen !== this.generation || this.interest.stats <= 0) return;
          raw = await read();
          if (gen !== this.generation || this.interest.stats <= 0) return;
        }
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
          batteryLevel: raw.batteryLevel ?? null,
          isCharging: Boolean(raw.isCharging),
          fullyCharged: Boolean(raw.fullyCharged),
          source: raw.source ?? "unknown",
        };
        this.patch({
          power,
          ready: { ...this.state.ready, power: true },
          error: { ...this.state.error, power: null },
        });
        return;
      }

      // net — counters are absolute; rate needs previous sample.
      const counters = await invoke<{
        totalBytesIn?: number;
        totalBytesOut?: number;
        total_bytes_in?: number;
        total_bytes_out?: number;
      }>("qx_system_monitor_network_counters");
      if (gen !== this.generation || this.interest.net <= 0) return;
      const now = performance.now();
      const bytesIn = Number(counters.totalBytesIn ?? counters.total_bytes_in) || 0;
      const bytesOut = Number(counters.totalBytesOut ?? counters.total_bytes_out) || 0;
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
