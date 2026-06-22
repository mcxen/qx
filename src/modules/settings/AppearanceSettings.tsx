import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qx-settings-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="qx-settings-row-title">{title}</div>
        {description && (
          <div className="qx-settings-row-description">{description}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="qx-segmented">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={active ? "is-active" : ""}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AppearanceSettings() {
  const { settings, patch } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const a = settings.appearance;

  return (
    <div className="qx-settings-page">
      <Row title="Theme" description="Choose the interface color scheme.">
        <SegmentedControl
          value={theme}
          onChange={(v) => {
            setTheme(v);
            patch("appearance", { ...a, theme: v });
          }}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </Row>
      <Row
        title="Frosted Glass Opacity"
        description={`Canvas transparency (${a.blur_opacity.toFixed(2)})`}
      >
        <input
          type="range"
          min={0.7}
          max={0.95}
          step={0.01}
          value={a.blur_opacity}
          onChange={(e) =>
            patch("appearance", { ...a, blur_opacity: parseFloat(e.target.value) })
          }
          style={{ width: 160 }}
        />
      </Row>
      <Row title="Window Size" description="Launcher window dimensions (min 400×300).">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            min={400}
            value={a.window_width}
            onChange={(e) =>
              patch("appearance", {
                ...a,
                window_width: Math.max(400, parseInt(e.target.value) || 400),
              })
            }
            style={{
              width: 64,
              textAlign: "center",
            }}
            className="qx-inline-input"
          />
          <span style={{ color: "var(--color-text-tertiary)" }}>×</span>
          <input
            type="number"
            min={300}
            value={a.window_height}
            onChange={(e) =>
              patch("appearance", {
                ...a,
                window_height: Math.max(300, parseInt(e.target.value) || 300),
              })
            }
            style={{
              width: 64,
              textAlign: "center",
            }}
            className="qx-inline-input"
          />
        </div>
      </Row>
      <Row title="Corner Radius" description="Window and card border radius.">
        <SegmentedControl
          value={String(a.border_radius)}
          onChange={(v) => patch("appearance", { ...a, border_radius: parseInt(v) })}
          options={[
            { value: "8", label: "8px" },
            { value: "12", label: "12px" },
            { value: "16", label: "16px" },
          ]}
        />
      </Row>
      <Row title="Font Size" description="Base UI font size.">
        <SegmentedControl
          value={String(a.font_size)}
          onChange={(v) => patch("appearance", { ...a, font_size: parseInt(v) })}
          options={[
            { value: "13", label: "13" },
            { value: "14", label: "14" },
            { value: "15", label: "15" },
            { value: "16", label: "16" },
          ]}
        />
      </Row>
    </div>
  );
}
