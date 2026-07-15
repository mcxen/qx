/**
 * macOS first-launch onboarding.
 *
 * Step 1 — Full Disk Access (files): guided System Settings hand-off, polled until granted or skipped.
 * Step 2 — Optional automation/capture/macros: Accessibility (clipboard paste), Screen Recording, Input Monitoring.
 *          User can enable all at once, pick one-by-one, or skip.
 *
 * Inspired by open-source patterns such as inket/FullDiskAccess (probe protected path + open Privacy pane).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../../i18n";
import { Button, Toggle } from "../../components/ui";
import { getQxDesktopPlatform } from "../../utils/keyboard";

export interface PermissionStatus {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  available: boolean;
  status: string;
  settings_url: string;
  required?: boolean;
  group?: string;
}

const PERMISSION_TIMEOUT_MS = 5000;
const POLL_MS = 1500;

const LABEL_KEYS: Record<string, string> = {
  "full-disk-access": "permissions.fullDiskAccess",
  accessibility: "permissions.accessibility",
  "screen-recording": "permissions.screenRecording",
  "input-monitoring": "permissions.inputMonitoring",
};

const DESC_KEYS: Record<string, string> = {
  "full-disk-access": "permissions.fullDiskAccess.desc",
  accessibility: "permissions.accessibility.desc",
  "screen-recording": "permissions.screenRecording.desc",
  "input-monitoring": "permissions.inputMonitoring.desc",
};

const WHY_KEYS: Record<string, string> = {
  "full-disk-access": "onboarding.why.fullDiskAccess",
  accessibility: "onboarding.why.accessibility",
  "screen-recording": "onboarding.why.screenRecording",
  "input-monitoring": "onboarding.why.inputMonitoring",
};

type Step = "welcome" | "files" | "optional" | "done";

async function invokeWithTimeout<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof window.setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("Permission check timed out.")),
          PERMISSION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function isMacOs(): boolean {
  return getQxDesktopPlatform() === "macos";
}

export interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const t = useT();
  const [step, setStep] = useState<Step>("welcome");
  const [items, setItems] = useState<PermissionStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOptional, setSelectedOptional] = useState<Record<string, boolean>>({
    accessibility: true,
    "screen-recording": false,
    "input-monitoring": false,
  });

  const loadPermissions = useCallback(async () => {
    if (!isMacOs()) return;
    setLoading(true);
    try {
      const next = await invokeWithTimeout<PermissionStatus[]>("qx_permissions_status");
      setItems(next);
    } catch (err) {
      setMessage(
        t("permissions.error", "Permission check failed: {message}").replace(
          "{message}",
          String(err),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  // Poll while on permission steps so toggling in System Settings is reflected live.
  useEffect(() => {
    if (step !== "files" && step !== "optional") return;
    if (!isMacOs()) return;
    const id = window.setInterval(() => {
      void loadPermissions();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [step, loadPermissions]);

  const byId = useMemo(() => {
    const map = new Map<string, PermissionStatus>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const fda = byId.get("full-disk-access");
  const optionalIds = ["accessibility", "screen-recording", "input-monitoring"] as const;
  const optionalItems = optionalIds
    .map((id) => byId.get(id))
    .filter((x): x is PermissionStatus => Boolean(x));

  const requestOne = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await invokeWithTimeout<boolean>("qx_permissions_request", { id });
      await loadPermissions();
      setMessage(
        t(
          "onboarding.requested",
          "System Settings opened. Enable Qx, then return here — status updates automatically.",
        ),
      );
    } catch (err) {
      setMessage(
        t("permissions.error", "Permission check failed: {message}").replace(
          "{message}",
          String(err),
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const requestSelectedOptional = async () => {
    const ids = optionalIds.filter((id) => selectedOptional[id] && !byId.get(id)?.granted);
    if (ids.length === 0) {
      setStep("done");
      return;
    }
    setBusyId("batch");
    setMessage(null);
    try {
      const next = await invokeWithTimeout<PermissionStatus[]>("qx_permissions_request_all", {
        ids,
      });
      setItems(next);
      setMessage(
        t(
          "onboarding.requestedBatch",
          "Opened permission panels for selected features. Toggle Qx on, then return here.",
        ),
      );
    } catch (err) {
      setMessage(
        t("permissions.error", "Permission check failed: {message}").replace(
          "{message}",
          String(err),
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const finish = () => {
    onComplete();
  };

  const stepIndex = step === "welcome" ? 0 : step === "files" ? 1 : step === "optional" ? 2 : 3;
  const stepLabels = [
    t("onboarding.step.welcome", "Welcome"),
    t("onboarding.step.files", "Files"),
    t("onboarding.step.optional", "Features"),
    t("onboarding.step.done", "Ready"),
  ];

  return (
    <div className="qx-onboarding" role="dialog" aria-modal="true" aria-labelledby="qx-onboarding-title">
      <div className="qx-onboarding-card">
        <div className="qx-onboarding-steps" aria-hidden="true">
          {stepLabels.map((label, i) => (
            <div
              key={label}
              className={`qx-onboarding-step-dot ${i === stepIndex ? "is-active" : ""} ${i < stepIndex ? "is-done" : ""}`}
            >
              <span className="qx-onboarding-step-index">{i + 1}</span>
              <span className="qx-onboarding-step-label">{label}</span>
            </div>
          ))}
        </div>

        {step === "welcome" && (
          <div className="qx-onboarding-body">
            <h1 id="qx-onboarding-title" className="qx-onboarding-title">
              {t("onboarding.welcome.title", "Welcome to Qx")}
            </h1>
            <p className="qx-onboarding-lead">
              {t(
                "onboarding.welcome.lead",
                "A quick setup so search, clipboard paste, and capture work as expected. You can change permissions later in Settings.",
              )}
            </p>
            <ul className="qx-onboarding-bullets">
              <li>
                {t(
                  "onboarding.welcome.bullet1",
                  "Full Disk Access once — unlock complete file search across protected folders.",
                )}
              </li>
              <li>
                {t(
                  "onboarding.welcome.bullet2",
                  "Optional: Accessibility for auto-paste, Screen Recording, and macro Input Monitoring.",
                )}
              </li>
              <li>
                {t(
                  "onboarding.welcome.bullet3",
                  "Everything is skippable; core launcher still works with reduced coverage.",
                )}
              </li>
            </ul>
            <div className="qx-onboarding-actions">
              <Button variant="default" onClick={() => setStep("files")}>
                {t("onboarding.welcome.continue", "Continue")}
              </Button>
              <Button variant="ghost" onClick={finish}>
                {t("onboarding.skipAll", "Skip setup")}
              </Button>
            </div>
          </div>
        )}

        {step === "files" && (
          <div className="qx-onboarding-body">
            <h1 id="qx-onboarding-title" className="qx-onboarding-title">
              {t("onboarding.files.title", "Full Disk Access")}
            </h1>
            <p className="qx-onboarding-lead">
              {t(
                "onboarding.files.lead",
                "Grant Full Disk Access once so Qx can index and search all files — including Mail, Messages, Safari, and other app containers. macOS does not allow apps to toggle this automatically.",
              )}
            </p>

            <div className={`qx-onboarding-perm ${fda?.granted ? "is-granted" : ""}`}>
              <div className="qx-onboarding-perm-main">
                <span
                  className={`qx-permission-light ${fda?.granted ? "is-granted" : "is-needed"}`}
                  aria-hidden="true"
                />
                <div>
                  <div className="qx-onboarding-perm-title">
                    {t(LABEL_KEYS["full-disk-access"], "Full Disk Access")}
                  </div>
                  <div className="qx-onboarding-perm-desc">
                    {t(
                      DESC_KEYS["full-disk-access"],
                      "Required for complete file search across protected folders.",
                    )}
                  </div>
                  <div className="qx-onboarding-perm-why">
                    {t(
                      WHY_KEYS["full-disk-access"],
                      "Without this, deep file search may miss protected locations.",
                    )}
                  </div>
                </div>
              </div>
              <div className="qx-onboarding-perm-status">
                {loading && !fda
                  ? t("permissions.checking", "Checking...")
                  : fda?.granted
                    ? t("permissions.granted", "Granted")
                    : t("permissions.needed", "Needed")}
              </div>
            </div>

            <ol className="qx-onboarding-howto">
              <li>{t("onboarding.files.howto1", "Click “Open System Settings”.")}</li>
              <li>
                {t(
                  "onboarding.files.howto2",
                  "Find Qx in Full Disk Access and turn the switch on.",
                )}
              </li>
              <li>
                {t(
                  "onboarding.files.howto3",
                  "Return here — status refreshes automatically. Restart Qx if macOS still shows Needed.",
                )}
              </li>
            </ol>

            {message && <div className="qx-onboarding-message">{message}</div>}

            <div className="qx-onboarding-actions">
              {!fda?.granted && (
                <Button
                  variant="default"
                  onClick={() => requestOne("full-disk-access")}
                  disabled={busyId === "full-disk-access"}
                >
                  {busyId === "full-disk-access"
                    ? t("permissions.opening", "Opening...")
                    : t("onboarding.openFda", "Open System Settings")}
                </Button>
              )}
              <Button
                variant={fda?.granted ? "default" : "secondary"}
                onClick={() => {
                  setMessage(null);
                  setStep("optional");
                }}
              >
                {fda?.granted
                  ? t("onboarding.next", "Next")
                  : t("onboarding.files.skip", "Skip for now")}
              </Button>
              <Button variant="ghost" onClick={() => void loadPermissions()} disabled={loading}>
                {t("permissions.refresh", "Refresh")}
              </Button>
            </div>
          </div>
        )}

        {step === "optional" && (
          <div className="qx-onboarding-body">
            <h1 id="qx-onboarding-title" className="qx-onboarding-title">
              {t("onboarding.optional.title", "Optional features")}
            </h1>
            <p className="qx-onboarding-lead">
              {t(
                "onboarding.optional.lead",
                "Choose what you need now. Accessibility enables clipboard auto-paste into other apps. You can enable or skip each item, or set them all at once.",
              )}
            </p>

            <div className="qx-onboarding-optional-list">
              {optionalItems.map((item) => {
                const id = item.id;
                const checked = Boolean(selectedOptional[id]);
                const granted = item.available && item.granted;
                return (
                  <div
                    key={id}
                    className={`qx-onboarding-optional-row ${granted ? "is-granted" : ""} ${checked ? "is-selected" : ""}`}
                  >
                    <Toggle
                      value={granted || checked}
                      disabled={granted}
                      ariaLabel={t(LABEL_KEYS[id] ?? item.label, item.label)}
                      onChange={(v) =>
                        setSelectedOptional((prev) => ({ ...prev, [id]: v }))
                      }
                    />
                    <span
                      className={`qx-permission-light ${granted ? "is-granted" : "is-needed"}`}
                      aria-hidden="true"
                    />
                    <div className="qx-onboarding-optional-copy">
                      <div className="qx-onboarding-perm-title">
                        {t(LABEL_KEYS[id] ?? item.label, item.label)}
                        {id === "accessibility" && (
                          <span className="qx-onboarding-badge">
                            {t("onboarding.badge.clipboard", "Clipboard paste")}
                          </span>
                        )}
                      </div>
                      <div className="qx-onboarding-perm-desc">
                        {t(DESC_KEYS[id] ?? item.description, item.description)}
                      </div>
                      <div className="qx-onboarding-perm-why">
                        {t(WHY_KEYS[id] ?? "", "")}
                      </div>
                    </div>
                    <div className="qx-onboarding-optional-side">
                      <span className={`qx-permission-status ${granted ? "is-granted" : "is-needed"}`}>
                        {granted
                          ? t("permissions.granted", "Granted")
                          : t("permissions.needed", "Needed")}
                      </span>
                      {!granted && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void requestOne(id)}
                          disabled={busyId === id || busyId === "batch"}
                        >
                          {busyId === id
                            ? t("permissions.opening", "Opening...")
                            : t("permissions.request", "Request")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {message && <div className="qx-onboarding-message">{message}</div>}

            <div className="qx-onboarding-actions">
              <Button
                variant="default"
                onClick={() => void requestSelectedOptional()}
                disabled={busyId === "batch"}
              >
                {busyId === "batch"
                  ? t("permissions.opening", "Opening...")
                  : t("onboarding.enableSelected", "Enable selected")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setMessage(null);
                  setStep("done");
                }}
              >
                {t("onboarding.optional.continue", "Continue")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMessage(null);
                  setStep("done");
                }}
              >
                {t("onboarding.skipOptional", "Skip optional")}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="qx-onboarding-body">
            <h1 id="qx-onboarding-title" className="qx-onboarding-title">
              {t("onboarding.done.title", "You're ready")}
            </h1>
            <p className="qx-onboarding-lead">
              {t(
                "onboarding.done.lead",
                "Summon Qx with ⌥Space (default). Open Settings → Permissions anytime to review access.",
              )}
            </p>
            <ul className="qx-onboarding-bullets">
              <li>
                {fda?.granted
                  ? t("onboarding.done.fdaOk", "Full Disk Access is on — file search can cover protected paths.")
                  : t(
                      "onboarding.done.fdaSkip",
                      "Full Disk Access was skipped — enable later for complete file search.",
                    )}
              </li>
              <li>
                {byId.get("accessibility")?.granted
                  ? t(
                      "onboarding.done.axOk",
                      "Accessibility is on — clipboard history can paste into other apps.",
                    )
                  : t(
                      "onboarding.done.axSkip",
                      "Accessibility off — you can still copy items; auto-paste needs Accessibility.",
                    )}
              </li>
            </ul>
            <div className="qx-onboarding-actions">
              <Button variant="default" onClick={finish}>
                {t("onboarding.done.start", "Start using Qx")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
