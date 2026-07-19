import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export function createSandboxIframe(html: string, visible: boolean): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.style.cssText = visible
    ? "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:visible;pointer-events:auto;z-index:1;"
    : "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden;pointer-events:none;z-index:-1;";
  iframe.srcdoc = html;
  return iframe;
}

export async function resolvePluginAssetUrl(
  pluginId: string,
  assetPath?: string,
): Promise<string | undefined> {
  const trimmed = assetPath?.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|asset:|blob:)/i.test(trimmed)) return trimmed;
  try {
    const result = await invoke<{ path: string }>("plugin_resolve_asset", {
      id: pluginId,
      assetPath: trimmed,
    });
    return convertFileSrc(result.path);
  } catch (error) {
    console.warn(`Failed to resolve plugin asset ${pluginId}/${trimmed}:`, error);
    return undefined;
  }
}
