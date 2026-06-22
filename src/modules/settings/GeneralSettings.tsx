import { useSettingsStore } from "./store";

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
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: value ? "var(--color-accent)" : "var(--color-surface-active)",
        position: "relative",
        cursor: "pointer",
        padding: 0,
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
          transition: "left 0.15s",
          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
        }}
      />
    </button>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="qx-inline-input"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function GeneralSettings() {
  const { settings, patch, reset } = useSettingsStore();
  const g = settings.general;

  return (
    <div className="qx-settings-page">
      <Row title="Launch at Login" description="Open Qx automatically when you log in.">
        <Toggle
          value={g.launch_at_login}
          onChange={(v) => patch("general", { ...g, launch_at_login: v })}
        />
      </Row>
      <Row title="Language" description="Interface language.">
        <Select
          value={g.language}
          onChange={(v) => patch("general", { ...g, language: v })}
          options={[
            { value: "en", label: "English" },
            { value: "zh-CN", label: "简体中文" },
          ]}
        />
      </Row>
      <Row title="Automatic Updates" description="Check for and install updates automatically.">
        <Toggle
          value={g.auto_update}
          onChange={(v) => patch("general", { ...g, auto_update: v })}
        />
      </Row>
      <Row title="Data Path" description="Where Qx stores databases, screenshots and history.">
        <input
          type="text"
          value={g.data_path}
          onChange={(e) => patch("general", { ...g, data_path: e.target.value })}
          style={{
            width: 280,
          }}
          className="qx-inline-input"
        />
      </Row>
      <Row
        title="Reset All Settings"
        description="Restore shortcuts, appearance and preferences to defaults."
      >
        <button
          onClick={() => void reset()}
          className="qx-command-button"
        >
          Reset
        </button>
      </Row>
    </div>
  );
}
