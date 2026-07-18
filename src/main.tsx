import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalQxLogging } from "./lib/logger";
import RecordingControlWindow from "./modules/screencap/RecordingControlWindow";
import RegionPickerWindow from "./modules/screencap/RegionPickerWindow";
import RegionPickerShadeWindow from "./modules/screencap/RegionPickerShadeWindow";
import IslandFloatApp from "./island/float/IslandFloatApp";
import { ThemeProvider } from "./ThemeProvider";
import { installOverlayScrollbars } from "./utils/overlayScrollbar";
import LoadingMarkLab from "./components/LoadingMarkLab";

installGlobalQxLogging();
installOverlayScrollbars();

const params = new URLSearchParams(window.location.search);
const surface = params.get("surface") ?? params.get("view");
const isRecordingControls = surface === "recording-controls";
const isRegionPicker = surface === "region-picker";
const isRegionPickerShade = surface === "region-picker-shade";
const isIslandFloat = surface === "island";
const isLoadingLab = surface === "loading-lab";

document.documentElement.classList.toggle("qx-loading-lab-page", isLoadingLab);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isRecordingControls ? (
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
  </React.StrictMode>,
);
