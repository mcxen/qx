import {
  forwardRef,
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronDown,
  MoveUpRight,
  Pencil,
  Play,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui";
import { useT } from "../../i18n";
import type { ScreencapSettings } from "../settings/store";
import type { AudioInput, CaptureMode } from "./store";
import { captureNumberForeground, captureNumberOutline } from "./captureColor";

export type CaptureTool = "text" | "arrow" | "rect" | "pen" | "number" | "mosaic" | null;
export type CaptureColor = "#ff3b30" | "#ffcc00" | "#5b8cff" | "#34c759" | "#ffffff";

const COLORS: CaptureColor[] = ["#ff3b30", "#ffcc00", "#5b8cff", "#34c759", "#ffffff"];

function CaptureFrameIcon({ dashed = false, recording = false, display = false }: { dashed?: boolean; recording?: boolean; display?: boolean }) {
  return (
    <svg width="23" height="20" viewBox="0 0 24 21" fill="none" aria-hidden="true">
      <rect
        x="2.25"
        y="2.25"
        width="17.5"
        height="13.5"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={dashed ? "3 2.2" : undefined}
      />
      {display ? <path d="M11 16v2.4m-3 0h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}
      {recording ? <circle className="qx-capture-record-dot" cx="18.7" cy="15.2" r="4.6" /> : null}
    </svg>
  );
}

/** Compact camera silhouette used for the screenshot/recording mode switch. */
function CaptureCameraIcon() {
  return (
    <svg width="23" height="20" viewBox="0 0 24 20" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="14" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 7.2 21 5v10l-7-2.2V7.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 4h12M10 4v12M7.5 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MosaicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="2" width="8" height="8" fill="currentColor" />
      <rect x="2" y="10" width="8" height="8" fill="currentColor" />
      <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

function ToolButton({ label, shortcut, children, active, disabled, className = "", onClick }: ToolButtonProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  useEffect(() => {
    setTooltipOpen(false);
  }, [label]);
  return (
    <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen} disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`${active ? "is-active " : ""}${className}`.trim()}
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
          onPointerEnter={() => setTooltipOpen(true)}
          onPointerMove={() => setTooltipOpen(true)}
          onPointerLeave={() => setTooltipOpen(false)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="qx-capture-tooltip">
        <span>{label}</span>
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function MenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="qx-capture-menu-section">
      <div className="qx-capture-menu-heading">{label}</div>
      {children}
    </div>
  );
}

function MenuItem({ label, checked = false, disabled = false, onClick }: {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="qx-capture-menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="qx-capture-menu-check" aria-hidden="true">
        {checked ? <Check size={13} strokeWidth={2.4} /> : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface CaptureToolbarProps {
  style?: CSSProperties;
  intent: CaptureMode;
  tool: CaptureTool;
  color: CaptureColor;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  settings: ScreencapSettings;
  onToggleIntent: () => void;
  onSelectRegion: () => void;
  onSelectFullscreen: () => void;
  onToolChange: (tool: CaptureTool) => void;
  onColorChange: (color: CaptureColor) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSettingsChange: (patch: Partial<ScreencapSettings>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onToolbarPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export const CaptureToolbar = forwardRef<HTMLDivElement, CaptureToolbarProps>(function CaptureToolbar({
  style,
  intent,
  tool,
  color,
  busy,
  canUndo,
  canRedo,
  settings,
  onToggleIntent,
  onSelectRegion,
  onSelectFullscreen,
  onToolChange,
  onColorChange,
  onUndo,
  onRedo,
  onSettingsChange,
  onConfirm,
  onCancel,
  onToolbarPointerDown,
  onToolbarPointerMove,
  onToolbarPointerUp,
}, ref) {
  const t = useT();
  const screenshot = intent === "screenshot";
  const toggleTool = (next: Exclude<CaptureTool, null>) => onToolChange(tool === next ? null : next);
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [audioError, setAudioError] = useState(false);
  const chooseDirectory = async () => {
    await invoke("floating_set_external_interaction_active", { active: true }).catch(() => {});
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      onSettingsChange(screenshot
        ? { screenshot_destination: "custom", screenshot_custom_directory: selected }
        : { recording_destination: "custom", recording_custom_directory: selected });
    } finally {
      await invoke("floating_set_external_interaction_active", { active: false }).catch(() => {});
    }
  };

  useEffect(() => {
    if (screenshot) return;
    let cancelled = false;
    setAudioError(false);
    void invoke<AudioInput[]>("screencap_list_audio_inputs")
      .then((inputs) => {
        if (!cancelled) setAudioInputs(inputs.filter((input) => input.available));
      })
      .catch(() => {
        if (!cancelled) setAudioError(true);
      });
    return () => { cancelled = true; };
  }, [screenshot]);

  return (
    <TooltipProvider delayDuration={280}>
      <div
        ref={ref}
        style={style}
        className={`qx-region-picker-toolbar is-${intent}`}
        onPointerDown={(event) => {
          event.stopPropagation();
          onToolbarPointerDown?.(event);
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          onToolbarPointerMove?.(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          onToolbarPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          onToolbarPointerUp?.(event);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qx-capture-toolbar-main">
        <ToolButton
          label={screenshot
            ? t("screencap.picker.switchRecording", "Switch to recording")
            : t("screencap.picker.switchScreenshot", "Switch to screenshot")}
          disabled={busy}
          className="is-mode-switch"
          shortcut={screenshot ? "V" : "S"}
          onClick={onToggleIntent}
        >
          <CaptureCameraIcon />
        </ToolButton>
        <span />
        <ToolButton shortcut="Tab" label={screenshot
          ? t("screencap.picker.regionScreenshot", "Capture selected region")
          : t("screencap.picker.regionRecording", "Record selected region")} disabled={busy} onClick={onSelectRegion}>
          <CaptureFrameIcon dashed recording={!screenshot} />
        </ToolButton>
        <ToolButton shortcut="Space" label={screenshot
          ? t("screencap.picker.fullScreenshot", "Capture full screen")
          : t("screencap.picker.fullRecording", "Record full screen")} disabled={busy} onClick={onSelectFullscreen}>
          <CaptureFrameIcon recording={!screenshot} display />
        </ToolButton>

        {screenshot ? (
          <>
            <span />
            <ToolButton shortcut="1" label={t("screencap.picker.rectangle", "Rectangle")} active={tool === "rect"} disabled={busy} onClick={() => toggleTool("rect")}>
              <CaptureFrameIcon />
            </ToolButton>
            <ToolButton shortcut="2" label={t("screencap.picker.arrow", "Arrow")} active={tool === "arrow"} disabled={busy} onClick={() => toggleTool("arrow")}>
              <MoveUpRight size={20} strokeWidth={1.8} />
            </ToolButton>
            <ToolButton shortcut="4" label={t("screencap.picker.pen", "Freehand pen")} active={tool === "pen"} disabled={busy} onClick={() => toggleTool("pen")}>
              <Pencil size={20} strokeWidth={1.8} />
            </ToolButton>
            <ToolButton shortcut="3" label={t("screencap.picker.text", "Text")} active={tool === "text"} disabled={busy} onClick={() => toggleTool("text")}>
              <TextIcon />
            </ToolButton>
            <ToolButton shortcut="5" label={t("screencap.picker.number", "Number marker")} active={tool === "number"} disabled={busy} onClick={() => toggleTool("number")}>
              <span
                className="qx-capture-number-icon"
                aria-hidden="true"
                style={{
                  background: color,
                  borderColor: captureNumberOutline(color),
                  color: captureNumberForeground(color),
                }}
              >
                1
              </span>
            </ToolButton>
            <ToolButton shortcut="6" label={t("screencap.picker.mosaic", "Mosaic")} active={tool === "mosaic"} disabled={busy} onClick={() => toggleTool("mosaic")}>
              <MosaicIcon size={16} />
            </ToolButton>
            <span />
            <ToolButton shortcut="⌘/Ctrl+Z" label={t("common.undo", "Undo")} disabled={!canUndo || busy} onClick={onUndo}>
              <Undo2 size={20} strokeWidth={1.8} />
            </ToolButton>
            <ToolButton shortcut="⇧⌘/Ctrl+Z" label={t("common.redo", "Redo")} disabled={!canRedo || busy} onClick={onRedo}>
              <Redo2 size={20} strokeWidth={1.8} />
            </ToolButton>
          </>
        ) : (
          <>
            <span />
            <ToolButton shortcut="6" label={t("screencap.picker.recordingMosaic", "Recording mosaic mask")} active={tool === "mosaic"} disabled={busy} onClick={() => toggleTool("mosaic")}>
              <MosaicIcon size={17} />
            </ToolButton>
          </>
        )}
        </div>
        <div className="qx-capture-toolbar-tail">
        <span />
        {screenshot ? (
          <>
            <div className="qx-capture-color-group">
              {COLORS.map((swatch) => (
                <Tooltip key={swatch}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={`qx-region-picker-swatch${color === swatch ? " is-active" : ""}`}
                      style={{ background: swatch }}
                      aria-label={t("screencap.picker.color", "Annotation color")}
                      onClick={() => onColorChange(swatch)}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("screencap.picker.color", "Annotation color")}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <span />
          </>
        ) : null}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className="qx-capture-options-trigger" disabled={busy}>
                  {t("screencap.picker.options", "Options")}
                  <ChevronDown size={14} />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t("screencap.picker.options", "Capture options")}</TooltipContent>
          </Tooltip>
          <PopoverContent className="qx-capture-options" side="top" align="end">
            <MenuSection label={t("screencap.picker.saveTo", "Save to")}>
              {([
                { value: "desktop", label: t("screencap.destination.desktop", "Desktop") },
                { value: "documents", label: t("screencap.destination.documents", "Documents") },
              ] as const).map((destination) => (
                <MenuItem
                  key={destination.value}
                  label={destination.label}
                  checked={(screenshot ? settings.screenshot_destination : settings.recording_destination) === destination.value}
                  onClick={() => onSettingsChange(screenshot
                    ? { screenshot_destination: destination.value, screenshot_open_after: "none", auto_copy_to_clipboard: false }
                    : { recording_destination: destination.value, recording_open_after: "none" })}
                />
              ))}
              {screenshot ? (
                <MenuItem
                  label={t("screencap.destination.clipboard", "Clipboard")}
                  checked={settings.screenshot_destination === "clipboard"}
                  onClick={() => onSettingsChange({ screenshot_destination: "clipboard", screenshot_open_after: "none", auto_copy_to_clipboard: true })}
                />
              ) : null}
              <MenuItem
                label={screenshot
                  ? t("screencap.openAfter.preview", "Preview")
                  : t("screencap.openAfter.player", "QuickTime Player")}
                checked={screenshot
                  ? settings.screenshot_destination === "library" && settings.screenshot_open_after === "preview"
                  : settings.recording_destination === "library" && settings.recording_open_after === "player"}
                onClick={() => onSettingsChange(screenshot
                  ? { screenshot_destination: "library", screenshot_open_after: "preview", auto_copy_to_clipboard: false }
                  : { recording_destination: "library", recording_open_after: "player" })}
              />
              <MenuItem
                label={t("screencap.destination.custom", "Other Location…")}
                checked={(screenshot ? settings.screenshot_destination : settings.recording_destination) === "custom"}
                onClick={() => {
                  onSettingsChange(screenshot
                    ? { screenshot_open_after: "none", auto_copy_to_clipboard: false }
                    : { recording_open_after: "none" });
                  void chooseDirectory();
                }}
              />
            </MenuSection>

            <MenuSection label={t("screencap.picker.delay", "Timer")}>
              {([0, 5, 10] as const).map((delay) => (
                <MenuItem
                  key={delay}
                  label={delay === 0 ? t("screencap.delay.none", "None") : `${delay} ${t("common.seconds", "Seconds")}`}
                  checked={(settings.capture_delay_seconds === 3 ? 5 : settings.capture_delay_seconds) === delay}
                  onClick={() => onSettingsChange({ capture_delay_seconds: delay })}
                />
              ))}
            </MenuSection>

            {!screenshot ? (
              <MenuSection label={t("screencap.picker.microphone", "Microphone")}>
                <MenuItem
                  label={t("screencap.picker.noMicrophone", "None")}
                  checked={settings.recording_microphone_id == null}
                  onClick={() => onSettingsChange({ recording_microphone_id: null })}
                />
                {audioInputs.map((input) => (
                  <MenuItem
                    key={input.id}
                    label={input.isDefault ? `${input.name} · ${t("common.default", "Default")}` : input.name}
                    checked={settings.recording_microphone_id === input.id}
                    onClick={() => onSettingsChange({ recording_microphone_id: input.id })}
                  />
                ))}
                {audioError ? (
                  <MenuItem
                    label={t("screencap.picker.microphoneUnavailable", "Microphone unavailable")}
                    disabled
                    onClick={() => {}}
                  />
                ) : null}
              </MenuSection>
            ) : null}

            <MenuSection label={t("screencap.picker.options", "Options")}>
              <MenuItem
                label={t("screencap.picker.floatingThumbnail", "Show Floating Thumbnail")}
                checked={settings.show_floating_thumbnail}
                onClick={() => onSettingsChange({ show_floating_thumbnail: !settings.show_floating_thumbnail })}
              />
              <MenuItem
                label={t("screencap.picker.rememberSelection", "Remember Last Selection")}
                checked={settings.remember_last_selection}
                onClick={() => onSettingsChange({ remember_last_selection: !settings.remember_last_selection })}
              />
              {screenshot ? (
                <>
                  <MenuItem
                    label={t("screencap.picker.showMainAfter", "Open main window after capture")}
                    checked={settings.show_main_after_screenshot}
                    onClick={() => onSettingsChange({
                      show_main_after_screenshot: !settings.show_main_after_screenshot,
                    })}
                  />
                  <MenuItem
                    label={t("screencap.picker.shutterSound", "Play Screenshot Sound")}
                    checked={settings.screenshot_sound_enabled}
                    onClick={() => onSettingsChange({ screenshot_sound_enabled: !settings.screenshot_sound_enabled })}
                  />
                  <MenuItem
                    label={t("screencap.picker.showPointer", "Show Mouse Pointer")}
                    checked={settings.screenshot_include_cursor}
                    onClick={() => onSettingsChange({ screenshot_include_cursor: !settings.screenshot_include_cursor })}
                  />
                </>
              ) : (
                <>
                  <MenuItem
                    label={t("screencap.picker.showPointer", "Show Mouse Pointer")}
                    checked={settings.recording_include_cursor}
                    onClick={() => onSettingsChange({ recording_include_cursor: !settings.recording_include_cursor })}
                  />
                  <MenuItem
                    label={t("screencap.picker.showClicks", "Show Mouse Clicks")}
                    checked={settings.recording_show_mouse_clicks}
                    onClick={() => onSettingsChange({ recording_show_mouse_clicks: !settings.recording_show_mouse_clicks })}
                  />
                </>
              )}
            </MenuSection>
          </PopoverContent>
        </Popover>
        <span />
        <ToolButton
          label={screenshot
            ? t("screencap.picker.confirmScreenshot", "Confirm screenshot")
            : t("screencap.picker.confirmRecording", "Confirm recording")}
          disabled={busy}
          className="is-icon is-confirm"
          shortcut="Enter"
          onClick={onConfirm}
        >
          {screenshot
            ? <Check size={17} strokeWidth={2.5} />
            : <Play size={17} fill="currentColor" strokeWidth={1.8} />}
        </ToolButton>
        <ToolButton shortcut="Esc" label={t("common.cancel", "Cancel")} disabled={busy} className="is-icon" onClick={onCancel}>
          <X size={16} />
        </ToolButton>
        </div>
      </div>
    </TooltipProvider>
  );
});
