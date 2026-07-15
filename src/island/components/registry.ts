import type { ComponentType } from "react";

export type IslandComponentProps = Record<string, unknown>;

const components = new Map<string, ComponentType<IslandComponentProps>>();

export function registerIslandComponent(
  id: string,
  Component: ComponentType<IslandComponentProps>,
): void {
  components.set(id, Component);
}

export function getIslandComponent(
  id: string,
): ComponentType<IslandComponentProps> | undefined {
  return components.get(id);
}

export function listIslandComponents(): string[] {
  return Array.from(components.keys());
}
