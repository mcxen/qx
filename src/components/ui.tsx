import { type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./shadcn/dialog";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./shadcn/select";
import { Skeleton } from "./shadcn/skeleton";
import { Slider as ShadcnSlider } from "./shadcn/slider";
import { Switch } from "./shadcn/switch";
import { ToggleGroup, ToggleGroupItem } from "./shadcn/toggle-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./shadcn/card";
import { Separator } from "./shadcn/separator";
import { ScrollArea, ScrollBar } from "./shadcn/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./shadcn/tabs";
export { Badge } from "./shadcn/badge";
export { Button } from "./shadcn/button";
export { Input } from "./shadcn/input";
export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./shadcn/popover";
export { Card, CardContent, CardDescription, CardHeader, CardTitle };
export { Separator };
export { ScrollArea, ScrollBar };
export { Tabs, TabsContent, TabsList, TabsTrigger };
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
};
export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./shadcn/context-menu";

export function SettingsCard({
  title,
  description,
  trailing,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`qx-card ${className}`.trim()}>
      <CardHeader>
        <div style={{ minWidth: 0 }}>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {trailing}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

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

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      checked={value}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-pressed={value}
    />
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
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.label}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value && !option.disabled)
    ?? options.find((option) => !option.disabled);
  const dividerValues = new Set(["---divider---"]);
  return (
    <div className={`qx-select ${className}`.trim()}>
      <ShadcnSelect
        value={selected?.value}
        onValueChange={(next) => onChange(next as T)}
      >
        <SelectTrigger aria-label={ariaLabel}>
          <SelectValue placeholder={selected?.label ?? ""} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, index) => {
            if (option.disabled && dividerValues.has(option.value)) {
              return (
                <SelectSeparator
                  key={`${option.value}-${index}`}
                  className="qx-shadcn-select-separator"
                />
              );
            }
            return (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </ShadcnSelect>
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  formatLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
  formatLabel?: (v: number) => string;
}) {
  return (
    <div className="qx-slider" role="none">
      <ShadcnSlider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel ?? "Slider"}
        aria-valuetext={formatLabel ? formatLabel(value) : String(value)}
        onValueChange={(next) => {
          const nextValue = next[0];
          if (typeof nextValue === "number") onChange(nextValue);
        }}
      />
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
}): ReactNode {
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
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent style={{ width: `min(${width}px, calc(100vw - 40px))` }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export { Skeleton };

export function LoadingSpinner({ size }: { size?: number }) {
  return (
    <LoaderCircle
      className="qx-loading-spinner"
      aria-hidden="true"
      size={size}
    />
  );
}

export function LoadingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="qx-loading-label">
      <LoadingSpinner />
      <span>{children}</span>
    </span>
  );
}
