/**
 * Cross-platform first-launch introduction plus macOS permission onboarding.
 *
 * Step 1 — Full Disk Access (files): guided System Settings hand-off, polled until granted or skipped.
 * Step 2 — Optional automation/capture/macros: Accessibility (clipboard paste), Screen Recording, Input Monitoring.
 *          User can enable all at once, pick one-by-one, or skip.
 *
 * Inspired by open-source patterns such as inket/FullDiskAccess (probe protected path + open Privacy pane).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Clipboard,
  Files,
  ScanLine,
  Search,
  Sparkles,
} from "lucide-react";
import { useT } from "../../i18n";
import { Button, Toggle } from "../../components/ui";
import {
  formatQxShortcut,
  getDefaultQxHostShortcuts,
  getQxDesktopPlatform,
} from "../../utils/keyboard";

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
  const macOs = isMacOs();
  const hostShortcuts = getDefaultQxHostShortcuts();
  const summonShortcut = formatQxShortcut(hostShortcuts.toggleWindow) ?? hostShortcuts.toggleWindow;
  const fileActionsShortcut = formatQxShortcut("Alt+F") ?? "Alt+F";
  const captureShortcut = formatQxShortcut("Ctrl+G") ?? "Ctrl+G";
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

  const stepLabels: Array<{ id: Step; label: string }> = macOs
    ? [
        { id: "welcome", label: t("onboarding.step.welcome", "Welcome") },
        { id: "files", label: t("onboarding.step.files", "Files") },
        { id: "optional", label: t("onboarding.step.optional", "Features") },
        { id: "done", label: t("onboarding.step.done", "Ready") },
      ]
    : [
        { id: "welcome", label: t("onboarding.step.welcome", "Welcome") },
        { id: "done", label: t("onboarding.step.done", "Ready") },
      ];
  const stepIndex = Math.max(0, stepLabels.findIndex((item) => item.id === step));

  const capabilities = [
    {
      icon: Search,
      title: t("onboarding.capability.search", "Search and launch"),
      description: t(
        "onboarding.capability.search.desc",
        "Find apps, files, commands, and module content from one keyboard-first surface.",
      ),
    },
    {
      icon: Files,
      title: t("onboarding.capability.files", "File Actions"),
      description: t(
        "onboarding.capability.files.desc",
        "Preview, compress, convert, rename, and review the latest five file jobs.",
      ),
    },
    {
      icon: Clipboard,
      title: t("onboarding.capability.clipboard", "Clipboard memory"),
      description: t(
        "onboarding.capability.clipboard.desc",
        "Bring text, images, and real file items back without breaking their native meaning.",
      ),
    },
    {
      icon: ScanLine,
      title: t("onboarding.capability.capture", "Capture and automate"),
      description: t(
        "onboarding.capability.capture.desc",
        "Capture the screen, record workflows, and extend Qx with focused modules.",
      ),
    },
  ];

  const shortcutCards = [
    {
      label: t("onboarding.shortcut.summon", "Summon Qx"),
      key: summonShortcut,
      description: t("onboarding.shortcut.summon.desc", "Search, launch, and switch modules"),
    },
    {
      label: t("onboarding.shortcut.files", "File Actions"),
      key: fileActionsShortcut,
      description: t("onboarding.shortcut.files.desc", "Enabled by default on first install"),
    },
    {
      label: t("onboarding.shortcut.capture", "Capture screen"),
      key: captureShortcut,
      description: t("onboarding.shortcut.capture.desc", "Start a precise region capture"),
    },
  ];

  return (
    <div
      className="qx-onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qx-onboarding-title"
      data-tauri-drag-region
    >
      <div className="qx-onboarding-card" data-step={step}>
        <div
          className="qx-onboarding-window-drag"
          data-tauri-drag-region
          aria-hidden="true"
        />
        <div className="qx-onboarding-steps" aria-hidden="true">
          {stepLabels.map(({ id, label }, i) => (
            <div
              key={id}
              className={`qx-onboarding-step-dot ${i === stepIndex ? "is-active" : ""} ${i < stepIndex ? "is-done" : ""}`}
            >
              <span className="qx-onboarding-step-index">{i + 1}</span>
              <span className="qx-onboarding-step-label">{label}</span>
            </div>
          ))}
        </div>

        {step === "welcome" && (
          <div className="qx-onboarding-body qx-onboarding-landing">
            <div className="qx-onboarding-hero">
              <div className="qx-onboarding-hero-copy">
                <div className="qx-onboarding-eyebrow">
                  <Sparkles size={13} aria-hidden="true" />
                  {t("onboarding.welcome.eyebrow", "Your desktop command layer")}
                </div>
                <h1 id="qx-onboarding-title" className="qx-onboarding-title">
                  {t("onboarding.welcome.title", "Move at the speed of intent")}
                </h1>
                <p className="qx-onboarding-lead">
                  {t(
                    "onboarding.welcome.lead",
                    "Qx unifies search, files, clipboard, capture, and extensions in one fast, keyboard-first workspace.",
                  )}
                </p>
              </div>
              <div className="qx-onboarding-core" aria-hidden="true">
                <span className="qx-onboarding-core-orbit" />
                <span className="qx-onboarding-core-mark">Qx</span>
                <span className="qx-onboarding-core-signal" />
              </div>
            </div>

            <div className="qx-onboarding-capabilities">
              {capabilities.map(({ icon: Icon, title, description }, index) => (
                <div className="qx-onboarding-capability" key={title}>
                  <span className="qx-onboarding-capability-index">0{index + 1}</span>
                  <Icon size={17} aria-hidden="true" />
                  <div>
                    <div className="qx-onboarding-capability-title">{title}</div>
                    <div className="qx-onboarding-capability-desc">{description}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="qx-onboarding-command-rail">
              <span>{t("onboarding.welcome.try", "Your first command")}</span>
              <kbd>{summonShortcut}</kbd>
              <ArrowRight size={13} aria-hidden="true" />
              <span>{t("onboarding.welcome.search", "Type what you need")}</span>
              <ArrowRight size={13} aria-hidden="true" />
              <kbd>Enter</kbd>
            </div>
            <div className="qx-onboarding-actions">
              <Button variant="default" onClick={() => setStep(macOs ? "files" : "done")}>
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
          <div className="qx-onboarding-body qx-onboarding-ready">
            <h1 id="qx-onboarding-title" className="qx-onboarding-title">
              {t("onboarding.done.title", "You're ready")}
            </h1>
            <p className="qx-onboarding-lead">
              {t(
                "onboarding.done.lead",
                "Three shortcuts are ready now. You can review or change every binding in Settings → Shortcuts.",
              )}
            </p>
            <div className="qx-onboarding-shortcuts">
              {shortcutCards.map((item) => (
                <div className="qx-onboarding-shortcut" key={item.label}>
                  <div>
                    <div className="qx-onboarding-shortcut-label">{item.label}</div>
                    <div className="qx-onboarding-shortcut-desc">{item.description}</div>
                  </div>
                  <kbd>{item.key}</kbd>
                </div>
              ))}
            </div>
            {macOs && (
              <ul className="qx-onboarding-bullets qx-onboarding-permission-summary">
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
            )}
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
