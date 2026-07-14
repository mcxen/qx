import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalQxLogging } from "./lib/logger";
import RecordingControlWindow from "./modules/screencap/RecordingControlWindow";
import { ThemeProvider } from "./ThemeProvider";

installGlobalQxLogging();

const isRecordingControls = new URLSearchParams(window.location.search).get("view") === "recording-controls";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isRecordingControls ? (
      <ThemeProvider>
        <RecordingControlWindow />
      </ThemeProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
