import { useEffect, useRef } from "react";
import { islandHost } from "../session/hostApi";
import type { IslandOpenTarget } from "../types";

export interface IslandErrorFeedback {
  id: string;
  title: string;
  error?: string | null;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  openTarget?: IslandOpenTarget;
}

/**
 * Project operational failures into the fixed-height host Island. This is the
 * replacement for inserting a transient error row below a setting, list item,
 * toolbar, or composer.
 */
export function useIslandError({
  id,
  title,
  error,
  actionLabel,
  onAction,
  openTarget,
}: IslandErrorFeedback): void {
  const sessionId = `feedback.error.${id}`;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const targetRef = useRef(openTarget);
  targetRef.current = openTarget;
  const targetKey = JSON.stringify(openTarget);
  const hasAction = Boolean(onAction);

  useEffect(() => {
    const message = error?.trim();
    if (!message) {
      islandHost.dismiss(sessionId);
      return;
    }
    islandHost.show({
      id: sessionId,
      priority: "error",
      source: "module",
      placement: "docked-or-float",
      ttlMs: 8_000,
      openTarget: targetRef.current,
      content: {
        primary: title,
        secondary: message,
        tone: "danger",
        action: actionLabel && hasAction
          ? { id: "default", label: actionLabel }
          : undefined,
      },
      actions: actionLabel && hasAction
        ? { default: () => actionRef.current?.() }
        : undefined,
    });
  }, [actionLabel, error, hasAction, targetKey, sessionId, title]);

  useEffect(() => () => islandHost.dismiss(sessionId), [sessionId]);
}
