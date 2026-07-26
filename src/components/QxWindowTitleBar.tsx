import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useT } from "../i18n";
import { Button } from "./ui";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default function QxWindowTitleBar({ title }: { title: string }) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const currentWindow = getCurrentWindow();
    let disposed = false;
    const refresh = () => {
      void currentWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(() => {});
    };
    refresh();
    const unlisten = currentWindow.onResized(refresh);
    return () => {
      disposed = true;
      void unlisten.then((off) => off());
    };
  }, []);

  const minimize = () => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().minimize().catch(() => {});
  };

  const toggleMaximize = () => {
    if (!isTauriRuntime()) return;
    const currentWindow = getCurrentWindow();
    void currentWindow
      .toggleMaximize()
      .then(() => currentWindow.isMaximized())
      .then(setMaximized)
      .catch(() => {});
  };

  const hide = () => {
    if (!isTauriRuntime()) return;
    void invoke("floating_hide_restore_focus").catch(() => getCurrentWindow().hide());
  };

  return (
    <div
      className="qx-window-titlebar"
      data-tauri-drag-region
      onDoubleClick={toggleMaximize}
    >
      <div className="qx-window-titlebar-title" data-tauri-drag-region>{title}</div>
      <div
        className="qx-window-titlebar-controls"
        data-qx-no-window-drag
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="qx-window-titlebar-button qx-window-minimize"
          onClick={minimize}
          aria-label={t("window.minimize", "Minimize")}
          title={t("window.minimize", "Minimize")}
        >
          <Minus size={13} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="qx-window-titlebar-button qx-window-maximize"
          onClick={toggleMaximize}
          aria-label={maximized ? t("window.restore", "Restore") : t("window.maximize", "Maximize")}
          title={maximized ? t("window.restore", "Restore") : t("window.maximize", "Maximize")}
        >
          {maximized
            ? <Minimize2 size={12} aria-hidden="true" />
            : <Maximize2 size={12} aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="qx-window-titlebar-button qx-window-close"
          onClick={hide}
          aria-label={t("window.close", "Close")}
          title={t("window.close", "Close")}
        >
          <X size={13} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
