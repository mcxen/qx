import type {
  PluginCommand,
  PluginManifest,
  PluginPanel,
} from "./types";

/**
 * The declaration fields that participate in Launcher search.
 *
 * This is intentionally a pure projection. It is shared by eager runtime
 * registration, manifest-only lazy registration, and the host-owned search
 * provider so a plugin has one search contract at every lifecycle stage.
 */
export interface PluginSearchMetadataInput {
  pluginId: string;
  pluginName: string;
  pluginDescription?: string;
  manifest?: Pick<
    PluginManifest,
    "name" | "description" | "keywords" | "names" | "descriptions" | "panel"
  > | null;
  command?: Pick<
    PluginCommand,
    "name" | "title" | "titles" | "description" | "descriptions" | "keywords"
  > | null;
  panel?: Pick<PluginPanel, "title" | "titles" | "keywords"> | null;
}

function appendSearchTerms(output: string[], seen: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const term = value.trim();
    if (!term) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(term);
  }
}

function appendLocaleMap(
  output: string[],
  seen: Set<string>,
  values?: Record<string, string> | null,
): void {
  appendSearchTerms(output, seen, values ? Object.values(values) : []);
}

/**
 * Return all searchable declaration terms for one plugin target.
 *
 * Manifest names are retained in every target's index so a
 * localized name works even when Qx is currently using another locale. The
 * panel declaration is part of the base target metadata, which also lets a
 * real command be found by the plugin's product name and panel aliases.
 * Freeform descriptions are display-only: incidental prose such as
 * "requires token" must not make an unrelated entry match "qui".
 */
export function buildPluginSearchTerms(input: PluginSearchMetadataInput): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const manifest = input.manifest;
  const panel = input.panel;
  const manifestPanel = manifest?.panel;
  const command = input.command;

  appendSearchTerms(output, seen, [
    input.pluginId,
    input.pluginName,
    manifest?.name,
  ]);
  appendSearchTerms(output, seen, manifest?.keywords);
  appendLocaleMap(output, seen, manifest?.names);

  appendSearchTerms(output, seen, [panel?.title, manifestPanel?.title]);
  appendLocaleMap(output, seen, panel?.titles);
  appendLocaleMap(output, seen, manifestPanel?.titles);
  appendSearchTerms(output, seen, panel?.keywords);
  appendSearchTerms(output, seen, manifestPanel?.keywords);

  appendSearchTerms(output, seen, [
    command?.name,
    command?.title,
  ]);
  appendLocaleMap(output, seen, command?.titles);
  appendSearchTerms(output, seen, command?.keywords);

  return output;
}
