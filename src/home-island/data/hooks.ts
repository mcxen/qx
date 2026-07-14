import { useMemo, useSyncExternalStore } from "react";
import { homeIslandDataBus } from "./bus";
import type { IslandDataChannel, IslandDataState } from "./types";

/**
 * Subscribe to island data channels.
 * Fetching is entirely async on the shared bus — this hook only reads cache.
 */
export function useIslandData(channels: readonly IslandDataChannel[]): IslandDataState {
  const key = useMemo(
    () => [...channels].sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels.join(",")],
  );

  const subscribe = useMemo(
    () => (onStoreChange: () => void) => {
      const list = (key ? key.split(",") : []) as IslandDataChannel[];
      return homeIslandDataBus.subscribe(list, () => onStoreChange());
    },
    [key],
  );

  return useSyncExternalStore(
    subscribe,
    () => homeIslandDataBus.getState(),
    () => homeIslandDataBus.getState(),
  );
}

export function useIslandStats() {
  const state = useIslandData(["stats"]);
  return {
    stats: state.stats,
    ready: state.ready.stats,
    error: state.error.stats,
  };
}

export function useIslandPower() {
  const state = useIslandData(["power"]);
  return {
    power: state.power,
    ready: state.ready.power,
    error: state.error.power,
  };
}

export function useIslandNet() {
  const state = useIslandData(["net"]);
  return {
    net: state.net,
    ready: state.ready.net,
    error: state.error.net,
  };
}
