import type {
  ActionHandler,
  IslandShowInput,
  IslandUpdateInput,
  IslandSession,
} from "../types";
import { actionRegistry } from "./actionRegistry";
import {
  dismissSession,
  getSnapshot,
  showSession,
  subscribe,
  updateSession,
} from "./store";
import { createQxLogger } from "../../lib/logger";

const log = createQxLogger("island.host");

/**
 * Module-facing island host. Sole public entry for show/update/dismiss.
 * Producers never pass generation on show (ignored if passed).
 */
export const islandHost = {
  show(input: IslandShowInput): { id: string; generation: number } {
    const result = showSession(input);
    if (!result) {
      return { id: input.id, generation: 0 };
    }
    return result;
  },

  update(
    id: string,
    patch: IslandUpdateInput,
  ): { ok: boolean; generation?: number } {
    return updateSession(id, patch);
  },

  dismiss(id: string): void {
    dismissSession(id);
  },

  bindActions(id: string, handlers: Record<string, ActionHandler>): () => void {
    return actionRegistry.bind(id, handlers);
  },

  /**
   * v1: no-op when main is visible (see §7.3 / KD16).
   * Float promote is wired in PR4; host remains stable for call sites.
   */
  requestFloat(id: string): void {
    log.debug("island requestFloat (v1 no-op until float surface)", { id });
  },

  getSnapshot(): IslandSession[] {
    return getSnapshot();
  },

  subscribe(listener: () => void): () => void {
    return subscribe(listener);
  },
};
