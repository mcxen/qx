import type { HomeIslandDefinition } from "../types";
import PulseIsland from "./PulseIsland";

export const pulseHomeIsland: HomeIslandDefinition = {
  id: "pulse",
  order: 40,
  titleKey: "appearance.homeIsland.pulse",
  titleFallback: "Pulse",
  hintKey: "appearance.homeIsland.pulse.hint",
  hintFallback: "Network up/down VU",
  preview: "↓↑",
  kind: "custom",
  Component: PulseIsland,
};
