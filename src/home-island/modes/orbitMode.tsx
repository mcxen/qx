import type { HomeIslandDefinition } from "../types";
import OrbitIsland from "./OrbitIsland";

export const orbitHomeIsland: HomeIslandDefinition = {
  id: "orbit",
  order: 60,
  titleKey: "appearance.homeIsland.orbit",
  titleFallback: "Orbit",
  hintKey: "appearance.homeIsland.orbit.hint",
  hintFallback: "Mission clock + CPU ring",
  preview: "◎",
  kind: "custom",
  Component: OrbitIsland,
};
