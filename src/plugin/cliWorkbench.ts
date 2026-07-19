/**
 * Public wrappers around the canonical plugin SDK runtime.
 *
 * The same self-contained factory is serialized into sandboxed plugin iframes,
 * so JSON/CLI/Workbench behavior has one implementation instead of a typed host
 * copy plus a hand-maintained inline-JavaScript copy.
 */
import type { PluginContext } from "./types";
import type { PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";
import {
  createPluginSdkRuntime,
  type PluginCliCore,
} from "./pluginSdkFactory";

export type { PluginCliCore } from "./pluginSdkFactory";

export type PluginCliJsonOptions = Parameters<PluginContext["cli"]["json"]>[0];
export type PluginCliLinesOptions = Parameters<PluginContext["cli"]["lines"]>[0];
export type PluginUiListItem = PluginWorkbenchItem;
export type PluginUiWorkbenchState = PluginWorkbenchState;

const hostSdkRuntime = createPluginSdkRuntime();

export const parseJsonLoose = hostSdkRuntime.parseJsonLoose;
export const parseJsonLines = hostSdkRuntime.parseJsonLines;
export const mapWithConcurrency = hostSdkRuntime.mapWithConcurrency;

export function enhancePluginCli(core: PluginCliCore): PluginContext["cli"] {
  return hostSdkRuntime.enhancePluginCli(core);
}

export function createPluginUiKit(): PluginContext["ui"] {
  return hostSdkRuntime.createPluginUiKit();
}

/** Inline JavaScript injected into sandboxed plugin iframes. */
export const PLUGIN_WORKBENCH_RUNTIME_JS = String.raw`
const { enhancePluginCli, createPluginUiKit } = (${createPluginSdkRuntime.toString()})();
`;
