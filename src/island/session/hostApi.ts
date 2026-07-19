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

export const ISLAND_FLOAT_REQUEST_EVENT = "qx:island-request-float";

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

  requestFloat(id: string): void {
    const session = getSnapshot().find((candidate) => candidate.id === id);
    if (
      !session ||
      session.placement === "docked" ||
      session.priority === "home"
    ) {
      log.debug("island requestFloat ignored for ineligible session", { id });
      return;
    }
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(ISLAND_FLOAT_REQUEST_EVENT, {
        detail: { sessionId: id },
      }),
    );
  },

  getSnapshot(): IslandSession[] {
    return getSnapshot();
  },

  subscribe(listener: () => void): () => void {
    return subscribe(listener);
  },
};
