import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarRange {
  from: string | null;
  to: string | null;
}

interface CalendarProps {
  value: CalendarRange;
  onChange: (range: CalendarRange) => void;
  locale: string;
  min?: string | null;
  max?: string | null;
  rangeLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
}

function fromIso(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDay(value: string, amount: number): string {
  const date = fromIso(value);
  date.setDate(date.getDate() + amount);
  return toIso(date);
}

function monthStart(value?: string | null): Date {
  const date = value ? fromIso(value) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function Calendar({
  value,
  onChange,
  locale,
  min,
  max,
  rangeLabel,
  previousMonthLabel,
  nextMonthLabel,
}: CalendarProps) {
  const [month, setMonth] = useState(() => monthStart(value.from ?? max));

  useEffect(() => {
    if (value.from) setMonth(monthStart(value.from));
  }, [value.from]);

  const monthLabel = month.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekdays = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      return date.toLocaleDateString(locale, { weekday: "narrow" });
    });
  }, [locale]);

  const days = useMemo(() => {
    const gridStart = new Date(month);
    gridStart.setDate(1 - month.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return { date, iso: toIso(date) };
    });
  }, [month]);

  const select = (iso: string) => {
    if (!value.from || value.to) {
      onChange({ from: iso, to: null });
      return;
    }
    onChange(iso < value.from
      ? { from: iso, to: value.from }
      : { from: value.from, to: iso });
  };

  const focusDate = (iso: string) => {
    const target = document.querySelector<HTMLButtonElement>(`[data-calendar-date="${iso}"]`);
    if (target) {
      target.focus();
      return;
    }
    setMonth(monthStart(iso));
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-calendar-date="${iso}"]`)?.focus();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    let amount = 0;
    if (event.key === "ArrowLeft") amount = event.shiftKey ? -7 : -1;
    if (event.key === "ArrowRight") amount = event.shiftKey ? 7 : 1;
    if (event.key === "ArrowUp") amount = -7;
    if (event.key === "ArrowDown") amount = 7;
    if (amount) {
      event.preventDefault();
      focusDate(shiftDay(iso, amount));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const target = fromIso(iso);
      target.setMonth(target.getMonth() + (event.key === "PageUp" ? -1 : 1));
      focusDate(toIso(target));
    }
  };

  const moveMonth = (amount: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <div className="qx-geist-calendar" aria-label={rangeLabel}>
      <div className="qx-geist-calendar-head">
        <button type="button" aria-label={previousMonthLabel} onClick={() => moveMonth(-1)}>
          <ChevronLeft size={14} />
        </button>
        <strong aria-live="polite">{monthLabel}</strong>
        <button type="button" aria-label={nextMonthLabel} onClick={() => moveMonth(1)}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="qx-geist-calendar-grid" role="grid">
        {weekdays.map((weekday, index) => (
          <span key={`${weekday}-${index}`} className="qx-geist-calendar-weekday" aria-hidden="true">
            {weekday}
          </span>
        ))}
        {days.map(({ date, iso }) => {
          const disabled = Boolean((min && iso < min) || (max && iso > max));
          const isStart = value.from === iso;
          const isEnd = value.to === iso;
          const inRange = Boolean(value.from && value.to && iso > value.from && iso < value.to);
          const outside = date.getMonth() !== month.getMonth();
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-calendar-date={iso}
              disabled={disabled}
              aria-selected={isStart || isEnd || inRange}
              aria-label={date.toLocaleDateString(locale, { dateStyle: "full" })}
              className={`${outside ? "is-outside " : ""}${inRange ? "is-range " : ""}${isStart ? "is-start " : ""}${isEnd ? "is-end" : ""}`.trim()}
              onClick={() => select(iso)}
              onKeyDown={(event) => handleKeyDown(event, iso)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
