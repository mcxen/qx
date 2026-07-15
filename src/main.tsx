import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalQxLogging } from "./lib/logger";
import RecordingControlWindow from "./modules/screencap/RecordingControlWindow";
import RegionPickerWindow from "./modules/screencap/RegionPickerWindow";
import IslandFloatApp from "./island/float/IslandFloatApp";
import { ThemeProvider } from "./ThemeProvider";

installGlobalQxLogging();

const params = new URLSearchParams(window.location.search);
const surface = params.get("surface") ?? params.get("view");
const isRecordingControls = surface === "recording-controls";
const isRegionPicker = surface === "region-picker";
const isIslandFloat = surface === "island";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isRecordingControls ? (
      <ThemeProvider>
        <RecordingControlWindow />
      </ThemeProvider>
    ) : isRegionPicker ? (
      <RegionPickerWindow />
    ) : isIslandFloat ? (
      <IslandFloatApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
