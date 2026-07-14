import type { HomeIslandDefinition } from "../types";

export const defaultHomeIsland: HomeIslandDefinition = {
  id: "default",
  order: 10,
  titleKey: "appearance.homeIsland.default",
  titleFallback: "Default",
  hintKey: "appearance.homeIsland.default.hint",
  hintFallback: "Status text",
  preview: "Qx",
  kind: "shell",
  resolveShellContent: ({ t }) => ({
    label: t("launcher.title", "Qx Launcher"),
    detail: t("launcher.idle", "Type to search apps and commands"),
  }),
};
