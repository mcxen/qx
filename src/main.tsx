import React, { useEffect, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalQxLogging } from "./lib/logger";
import { installSafeTauriEventUnlisten } from "./lib/tauriEventSafety";
import RecordingControlWindow from "./modules/screencap/RecordingControlWindow";
import RegionPickerWindow from "./modules/screencap/RegionPickerWindow";
import RegionPickerShadeWindow from "./modules/screencap/RegionPickerShadeWindow";
import IslandFloatApp from "./island/float/IslandFloatApp";
import { ThemeProvider } from "./ThemeProvider";
import { installOverlayScrollbars } from "./utils/overlayScrollbar";
import LoadingMarkLab from "./components/LoadingMarkLab";
import TrayPanelApp from "./tray/TrayPanelApp";
import UpdateProgressApp from "./updater/UpdateProgressApp";

installSafeTauriEventUnlisten();
installGlobalQxLogging();
installOverlayScrollbars();

const params = new URLSearchParams(window.location.search);
const surface = params.get("surface") ?? params.get("view");
const isRecordingControls = surface === "recording-controls";
const isRegionPicker = surface === "region-picker";
const isRegionPickerShade = surface === "region-picker-shade";
const isIslandFloat = surface === "island";
const isLoadingLab = surface === "loading-lab";
const isTrayPanel = surface === "tray";
const isUpdateProgress = surface === "update-progress";

document.documentElement.classList.toggle("qx-loading-lab-page", isLoadingLab);

function BootSurfaceGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const surface = document.getElementById("qx-boot-surface");
      surface?.classList.add("is-ready");
      window.setTimeout(() => surface?.remove(), 180);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BootSurfaceGuard>
      {isUpdateProgress ? (
        <ThemeProvider>
          <UpdateProgressApp />
        </ThemeProvider>
      ) : isTrayPanel ? (
        <TrayPanelApp />
      ) : isRecordingControls ? (
        <ThemeProvider>
          <RecordingControlWindow />
        </ThemeProvider>
      ) : isRegionPickerShade ? (
        <RegionPickerShadeWindow />
      ) : isRegionPicker ? (
        <RegionPickerWindow />
      ) : isIslandFloat ? (
        <IslandFloatApp />
      ) : isLoadingLab ? (
        <ThemeProvider>
          <LoadingMarkLab />
        </ThemeProvider>
      ) : (
        <App />
      )}
    </BootSurfaceGuard>
  </React.StrictMode>,
);
