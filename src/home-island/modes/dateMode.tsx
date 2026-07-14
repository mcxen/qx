import type { HomeIslandDefinition } from "../types";
import DateIsland from "./DateIsland";

export const dateHomeIsland: HomeIslandDefinition = {
  id: "date",
  order: 30,
  titleKey: "appearance.homeIsland.date",
  titleFallback: "Date",
  hintKey: "appearance.homeIsland.date.hint",
  hintFallback: "Dot matrix clock",
  preview: "12:00",
  kind: "custom",
  Component: DateIsland,
};
