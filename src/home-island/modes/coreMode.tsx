import type { HomeIslandDefinition } from "../types";
import CoreIsland from "./CoreIsland";

export const coreHomeIsland: HomeIslandDefinition = {
  id: "core",
  order: 50,
  titleKey: "appearance.homeIsland.core",
  titleFallback: "Core",
  hintKey: "appearance.homeIsland.core.hint",
  hintFallback: "Battery reactor bar",
  preview: "⚡",
  kind: "custom",
  Component: CoreIsland,
};
