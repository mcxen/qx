// Production Workbench + Shell; synthetic images, no native writes or upstream services.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
mockWindows("main");
const pending: Array<() => void> = [];
mockIPC((command) => command === "plugin_workbench_cache_image"
  ? new Promise((_, reject) => pending.push(() => reject(new Error("Synthetic unavailable image")))) : command === "plugin:event|listen" ? 1 : null);
import { useState } from "react";
import { createRoot } from "react-dom/client";
import QxShell from "../../src/components/QxShell";
import PluginWorkbenchView from "../../src/plugin/PluginWorkbenchView";
import { useQxModuleShell } from "../../src/hooks/useQxModuleShell";
import { useSettingsStore } from "../../src/modules/settings/store";
import type { PluginWorkbenchImage } from "../../src/plugin/workbenchTypes";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, general: { ...settings.general, language: params.get("locale") === "zh" ? "zh-CN" : "en" } } });
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
document.documentElement.style.background = "var(--qx-bg-100)";
const picture = (width: number, height: number, alt: string): PluginWorkbenchImage => ({
  url: `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="#d8e6ef"/><path d="M0 0H100V100" fill="none" stroke="#5e8ca8"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/><text x="20" y="70" font-size="42">${alt} TOP</text><text x="20" y="${height - 30}" font-size="42">BOTTOM</text></svg>`)}`,
  alt, fit: "contain", zoomable: true,
});
const images = [picture(1920, 1080, "Landscape"), picture(600, 900, "Portrait"), picture(600, 3000, "Long image")];
const calls: string[] = [];
function Fixture() {
  const [detailOpen, setDetailOpen] = useState(true);
  const [kind, setKind] = useState(params.get("kind") ?? "normal");
  Object.assign(window, { fixture: { calls, kind: setKind, release: () => pending.splice(0).forEach((resolve) => resolve()) } });
  const shell = useQxModuleShell({ leave: () => calls.push("leave"), esc: { inner: { active: detailOpen, close: () => setDetailOpen(false) } } });
  const media = kind === "slow" ? [images[0], ...Array.from({ length: 8 }, (_, index) => ({ url: `https://media.example.test/${index}.jpg`, alt: `Pending ${index}` }))] : images;
  return <QxShell title="Media fixture" islandKey="media-fixture" {...shell.shellProps} contentMode="fill">
    <PluginWorkbenchView pluginId="media-fixture" detailOpen={detailOpen} onActivate={() => setDetailOpen(true)} onInput={() => {}} onAction={() => {}} onDownload={() => {}}
      state={{ items: [{ id: "wallpaper", title: "Wallpaper", detail: { title: "Wallpaper", ...(kind === "single" ? { image: { ...images[0], aspectRatio: "landscape" as const } } : { images: media }) } }], selectedId: "wallpaper" }} />
  </QxShell>;
}
createRoot(document.getElementById("root")!).render(<div className="qx-canvas"><Fixture /></div>);
