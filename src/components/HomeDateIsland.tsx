import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";

import { Matrix, digits, emptyFrame, type Frame } from "./Matrix";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatSolarDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function formatLunarDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

function colonGlyph(blink: boolean): Frame {
  const frame = emptyFrame(7, 1);
  if (blink) {
    frame[2][0] = 1;
    frame[4][0] = 1;
  }
  return frame;
}

function paste(target: Frame, source: Frame, colOffset: number) {
  for (let r = 0; r < source.length && r < target.length; r++) {
    for (let c = 0; c < source[r].length; c++) {
      target[r][colOffset + c] = source[r][c];
    }
  }
}

function buildTimeFrame(hhmm: string, colonOn: boolean): { frame: Frame; cols: number } {
  const chars = hhmm.replace(/[^0-9]/g, "").slice(0, 4).padEnd(4, "0");
  const colon = colonGlyph(colonOn);
  const separator = emptyFrame(7, 1);
  const segments: Frame[] = [
    digits[Number(chars[0])] ?? digits[0],
    separator,
    digits[Number(chars[1])] ?? digits[0],
    colon,
    separator,
    digits[Number(chars[2])] ?? digits[0],
    separator,
    digits[Number(chars[3])] ?? digits[0],
  ];
  const cols = segments.reduce((acc, s) => acc + s[0].length, 0);
  const frame = emptyFrame(7, cols);
  let offset = 0;
  for (const seg of segments) {
    paste(frame, seg, offset);
    offset += seg[0].length;
  }
  return { frame, cols };
}

export default function HomeDateIsland() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = useMemo(
    () => ({
      time: formatTime(now),
      solar: formatSolarDate(now),
      lunar: formatLunarDate(now),
    }),
    [now],
  );

  const colonOn = now.getSeconds() % 2 === 0;
  const { frame: timeFrame, cols: timeCols } = useMemo(
    () => buildTimeFrame(parts.time, colonOn),
    [parts.time, colonOn],
  );

  const marqueeRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = marqueeRef.current;
    if (el) {
      const group = el.firstElementChild;
      if (group) {
        setOverflowing(group.scrollWidth > el.clientWidth);
      }
    }
  }, [parts]);

  return (
    <div className="qx-home-date-island" aria-label="Date display">
      <div
        ref={marqueeRef}
        className={`qx-island-marquee${overflowing ? " is-overflowing" : ""}`}
      >
        {overflowing ? (
          <>
            <div className="qx-island-marquee-group" key={0}>
              <Matrix
                rows={7}
                cols={timeCols}
                pattern={timeFrame}
                size={4}
                gap={1}
                ariaLabel={`current time ${parts.time}`}
                className="qx-date-matrix"
                palette={{
                  on: "var(--qx-system-island-text)",
                  off: "color-mix(in srgb, var(--qx-system-island-muted) 24%, transparent)",
                }}
              />
              <span className="qx-date-copy">
                <span>{parts.solar}</span>
                {parts.lunar && <span>农历 {parts.lunar}</span>}
              </span>
            </div>
            <div className="qx-island-marquee-group" aria-hidden key={1}>
              <Matrix
                rows={7}
                cols={timeCols}
                pattern={timeFrame}
                size={4}
                gap={1}
                ariaLabel={`current time ${parts.time}`}
                className="qx-date-matrix"
                palette={{
                  on: "var(--qx-system-island-text)",
                  off: "color-mix(in srgb, var(--qx-system-island-muted) 24%, transparent)",
                }}
              />
              <span className="qx-date-copy">
                <span>{parts.solar}</span>
                {parts.lunar && <span>农历 {parts.lunar}</span>}
              </span>
            </div>
          </>
        ) : (
          <div className="qx-island-marquee-group">
            <Matrix
              rows={7}
              cols={timeCols}
              pattern={timeFrame}
              size={4}
              gap={1}
              ariaLabel={`current time ${parts.time}`}
              className="qx-date-matrix"
              palette={{
                on: "var(--qx-system-island-text)",
                off: "color-mix(in srgb, var(--qx-system-island-muted) 24%, transparent)",
              }}
            />
            <span className="qx-date-copy">
              <span>{parts.solar}</span>
              {parts.lunar && <span>农历 {parts.lunar}</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}