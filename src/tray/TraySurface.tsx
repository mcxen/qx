import type { PointerEventHandler, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../components/ui";
import type { TraySurfaceSize } from "./surface";

export function TraySurfaceFrame({
  size,
  icon,
  title,
  closeLabel,
  onClose,
  onPointerEnter,
  onPointerLeave,
  children,
  footer,
}: {
  size: TraySurfaceSize;
  icon?: ReactNode;
  title: string;
  closeLabel: string;
  onClose: () => void;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      className="qx-tray-panel"
      data-size={size}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header className="qx-tray-panel-header">
        <span>{icon}{title}</span>
        <Button size="icon" variant="ghost" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
          <X size={14} />
        </Button>
      </header>
      <section className="qx-tray-panel-content">{children}</section>
      <footer className="qx-tray-panel-footer">{footer}</footer>
    </main>
  );
}

export function TraySection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="qx-tray-section">
      {title && <div className="qx-tray-section-title">{title}</div>}
      {children}
    </section>
  );
}

export function TrayControlCard({
  title,
  value,
  leading,
  children,
}: {
  title: string;
  value?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="qx-tray-display">
      <div className="qx-tray-display-head"><strong>{title}</strong><span>{value}</span></div>
      <div className="qx-tray-display-control">{leading}<div className="qx-tray-control-body">{children}</div></div>
    </article>
  );
}

export function TrayActionRow({
  icon,
  title,
  description,
  trailing,
  onClick,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button className="qx-tray-action-row" type="button" variant="ghost" onClick={onClick}>
      <span className="qx-tray-row-leading">{icon}</span>
      <span className="qx-tray-row-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      {trailing && <span className="qx-tray-row-trailing">{trailing}</span>}
    </Button>
  );
}

export function TrayStatusRow({ icon, title, value }: { icon?: ReactNode; title: string; value: ReactNode }) {
  return (
    <div className="qx-tray-status-row">
      <span className="qx-tray-row-leading">{icon}</span>
      <span className="qx-tray-row-copy"><strong>{title}</strong></span>
      <span className="qx-tray-row-trailing">{value}</span>
    </div>
  );
}

export function TrayShortcutGrid({ children }: { children: ReactNode }) {
  return <div className="qx-tray-shortcut-grid">{children}</div>;
}

export function TrayShortcutButton({ icon, title, description, onClick }: {
  icon?: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <Button className="qx-tray-shortcut" type="button" variant="ghost" onClick={onClick}>
      {icon}<strong>{title}</strong>{description && <small>{description}</small>}
    </Button>
  );
}
