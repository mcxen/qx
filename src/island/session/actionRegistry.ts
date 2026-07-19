import type { ActionHandler } from "../types";
import { createQxLogger } from "../../lib/logger";

const log = createQxLogger("island.actions");

interface ActionRegistry {
  bind(sessionId: string, handlers: Record<string, ActionHandler>): () => void;
  unbind(sessionId: string): void;
  dispatch(sessionId: string, actionId: string): boolean;
  run(sessionId: string, actionId: string): Promise<boolean>;
}

const handlersBySession = new Map<string, Map<string, ActionHandler>>();

export const actionRegistry: ActionRegistry = {
  bind(sessionId, handlers) {
    let map = handlersBySession.get(sessionId);
    if (!map) {
      map = new Map();
      handlersBySession.set(sessionId, map);
    }
    for (const [id, fn] of Object.entries(handlers)) {
      map.set(id, fn);
    }
    return () => {
      const current = handlersBySession.get(sessionId);
      if (!current) return;
      for (const id of Object.keys(handlers)) {
        current.delete(id);
      }
      if (current.size === 0) handlersBySession.delete(sessionId);
    };
  },

  unbind(sessionId) {
    handlersBySession.delete(sessionId);
  },

  dispatch(sessionId, actionId) {
    const handler = handlersBySession.get(sessionId)?.get(actionId);
    if (!handler) {
      log.debug("island action miss", { sessionId, actionId });
      return false;
    }
    try {
      void Promise.resolve(handler()).catch((error) => {
        log.debug("island action error", { sessionId, actionId, error });
      });
      return true;
    } catch (error) {
      log.debug("island action error", { sessionId, actionId, error });
      // The action existed and was accepted; callers must not fall through to
      // a compatibility handler and execute the intent twice.
      return true;
    }
  },

  async run(sessionId, actionId) {
    const handler = handlersBySession.get(sessionId)?.get(actionId);
    if (!handler) {
      log.debug("island action miss", { sessionId, actionId });
      return false;
    }
    try {
      await handler();
      return true;
    } catch (error) {
      log.debug("island action error", { sessionId, actionId, error });
      return true;
    }
  },
};

/** Test helper — clear all bindings. */
export function __resetActionRegistryForTests(): void {
  handlersBySession.clear();
}
