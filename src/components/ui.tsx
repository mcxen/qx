import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="qx-settings-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="qx-settings-row-title">{title}</div>
        {description && (
          <div className="qx-settings-row-description">{description}</div>
        )}
      </div>
      <div className="qx-settings-row-control">
        {children}
      </div>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`qx-toggle${value ? " is-on" : ""}`}
      aria-pressed={value}
    >
      <span className="qx-toggle-knob" />
    </button>
  );
}

export function SegmentedControl<T extends string>({
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
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={o.value === value ? "is-active" : ""}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  const activeId = useMemo(
    () => `${listboxId}-option-${selected?.value ?? "none"}`,
    [listboxId, selected?.value],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  const move = (delta: number) => {
    if (!options.length) return;
    const next = (selectedIndex + delta + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      ref={rootRef}
      className={`qx-select ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`qx-select-trigger${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? activeId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span>{selected?.label ?? ""}</span>
        <span className="qx-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={listboxId} className="qx-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              id={`${listboxId}-option-${option.value}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`qx-select-option${option.value === value ? " is-active" : ""}`}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LinkButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="qx-link-button"
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="qx-kbd">{children}</kbd>;
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  width = 440,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="qx-modal-overlay" onClick={onClose}>
      <div
        className="qx-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: Math.min(width, window.innerWidth - 40) }}
      >
        <div className="qx-modal-title">{title}</div>
        {subtitle && <div className="qx-modal-subtitle">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}
