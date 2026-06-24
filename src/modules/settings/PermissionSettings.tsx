import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../../i18n";

interface PermissionStatus {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  available: boolean;
  status: "granted" | "needed" | "unknown" | "unsupported" | string;
  settings_url: string;
}

const PERMISSION_CHECK_TIMEOUT_MS = 5000;

async function invokeWithTimeout<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof window.setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("Permission check timed out.")),
          PERMISSION_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

const LABEL_KEYS: Record<string, string> = {
  "screen-recording": "permissions.screenRecording",
  accessibility: "permissions.accessibility",
  "input-monitoring": "permissions.inputMonitoring",
};

const DESC_KEYS: Record<string, string> = {
  "screen-recording": "permissions.screenRecording.desc",
  accessibility: "permissions.accessibility.desc",
  "input-monitoring": "permissions.inputMonitoring.desc",
};

function statusLabel(status: PermissionStatus, t: (key: string, fallback: string) => string) {
  if (!status.available) return t("permissions.unsupported", "Unsupported");
  return status.granted
    ? t("permissions.granted", "Granted")
    : t("permissions.needed", "Needed");
}

export default function PermissionSettings() {
  const t = useT();
  const [items, setItems] = useState<PermissionStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const next = await invokeWithTimeout<PermissionStatus[]>("qx_permissions_status");
      setItems(next);
    } catch (err) {
      setMessage(t("permissions.error", "Permission check failed: {message}").replace("{message}", String(err)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  const grantedCount = useMemo(
    () => items.filter((item) => item.available && item.granted).length,
    [items],
  );
  const availableCount = useMemo(
    () => items.filter((item) => item.available).length,
    [items],
  );

  const requestPermission = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await invokeWithTimeout<boolean>("qx_permissions_request", { id });
      await loadPermissions();
      setMessage(t("permissions.requested", "System permission panel opened. Refresh after granting access."));
    } catch (err) {
      setMessage(t("permissions.error", "Permission check failed: {message}").replace("{message}", String(err)));
    } finally {
      setBusyId(null);
    }
  };

  const openPermissionSettings = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await invokeWithTimeout("qx_permissions_open_settings", { id });
      setMessage(t("permissions.opened", "System Settings opened. Refresh after changing access."));
    } catch (err) {
      setMessage(t("permissions.error", "Permission check failed: {message}").replace("{message}", String(err)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="qx-settings-page">
      <div className="qx-permissions-summary">
        <div>
          <div className="qx-permissions-summary-title">
            {t("permissions.title", "macOS Permissions")}
          </div>
          <div className="qx-permissions-summary-desc">
            {t(
              "permissions.desc",
              "Check the system permissions Qx needs for screenshots, GIF recording, and macros.",
            )}
          </div>
        </div>
        <div className="qx-permissions-score">
          {loading ? t("permissions.checking", "Checking...") : `${grantedCount}/${availableCount}`}
        </div>
      </div>

      <div className="qx-permissions-list">
        {items.map((item) => {
          const granted = item.available && item.granted;
          const label = t(LABEL_KEYS[item.id] ?? item.label, item.label);
          const description = t(DESC_KEYS[item.id] ?? item.description, item.description);
          return (
            <div key={item.id} className="qx-permission-row">
              <div className="qx-permission-main">
                <span
                  className={`qx-permission-light ${granted ? "is-granted" : "is-needed"}`}
                  aria-hidden="true"
                />
                <div className="qx-permission-copy">
                  <div className="qx-permission-title">{label}</div>
                  <div className="qx-permission-desc">{description}</div>
                </div>
              </div>
              <div className="qx-permission-actions">
                <span className={`qx-permission-status ${granted ? "is-granted" : "is-needed"}`}>
                  {statusLabel(item, t)}
                </span>
                {!granted && item.available && (
                  <button
                    className="qx-command-button primary"
                    onClick={() => requestPermission(item.id)}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id
                      ? t("permissions.opening", "Opening...")
                      : t("permissions.request", "Request")}
                  </button>
                )}
                <button
                  className="qx-command-button"
                  onClick={() => openPermissionSettings(item.id)}
                  disabled={!item.available || busyId === item.id}
                >
                  {t("permissions.openSettings", "Open")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="qx-permissions-footer">
        <button className="qx-command-button" onClick={loadPermissions} disabled={loading}>
          {loading ? t("permissions.checking", "Checking...") : t("permissions.refresh", "Refresh")}
        </button>
        {message && <span className="qx-permissions-message">{message}</span>}
      </div>
    </div>
  );
}
