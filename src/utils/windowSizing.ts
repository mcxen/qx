export type LogicalWindowSize = {
  width: number;
  height: number;
};

const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_WIDTH = 1500;
const MAX_WINDOW_HEIGHT = 882;
const FIRST_LAUNCH_WINDOW_RATIO = 0.6;
const PREFERRED_FIRST_LAUNCH_WIDTH = 980;
const PREFERRED_FIRST_LAUNCH_HEIGHT = 612;
const FIRST_LAUNCH_ASPECT_RATIO = 1.6;
const MONITOR_WIDTH_LIMIT = 0.9;
const MONITOR_HEIGHT_LIMIT = 0.85;
const COMFORTABLE_WIDTH_RATIO = 0.7;
const COMFORTABLE_HEIGHT_RATIO = 0.75;
const RESTORED_WINDOW_LIMIT = 0.9;
const COMPACT_RESTORED_WINDOW_LIMIT = 0.84;

export function clampWindowSize(width: number, height: number): LogicalWindowSize {
  return {
    width: Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(width || 0))),
    height: Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, Math.round(height || 0))),
  };
}

function monitorCanComfortablyFitPreferredWindow(monitorSize: LogicalWindowSize): boolean {
  return (
    PREFERRED_FIRST_LAUNCH_WIDTH <= monitorSize.width * COMFORTABLE_WIDTH_RATIO &&
    PREFERRED_FIRST_LAUNCH_HEIGHT <= monitorSize.height * COMFORTABLE_HEIGHT_RATIO
  );
}

export function getFirstLaunchWindowSizeForMonitor(
  monitorSize: LogicalWindowSize | null,
): LogicalWindowSize {
  if (!monitorSize) {
    return clampWindowSize(PREFERRED_FIRST_LAUNCH_WIDTH, PREFERRED_FIRST_LAUNCH_HEIGHT);
  }

  // Preserve the roomy launcher on normal displays. On compact Windows/RDP
  // work areas, let the responsive layout collapse instead of forcing the old
  // 980 x 612 floor to consume nearly the entire desktop.
  const usePreferredFloor = monitorCanComfortablyFitPreferredWindow(monitorSize);
  const minimumWidth = usePreferredFloor ? PREFERRED_FIRST_LAUNCH_WIDTH : MIN_WINDOW_WIDTH;
  const minimumHeight = usePreferredFloor ? PREFERRED_FIRST_LAUNCH_HEIGHT : MIN_WINDOW_HEIGHT;
  const width = Math.min(
    Math.max(minimumWidth, monitorSize.width * FIRST_LAUNCH_WINDOW_RATIO),
    monitorSize.width * MONITOR_WIDTH_LIMIT,
  );
  const height = Math.min(
    Math.max(minimumHeight, width / FIRST_LAUNCH_ASPECT_RATIO),
    monitorSize.height * MONITOR_HEIGHT_LIMIT,
  );
  return clampWindowSize(width, height);
}

export function clampWindowSizeForMonitor(
  width: number,
  height: number,
  monitorSize: LogicalWindowSize | null,
): LogicalWindowSize {
  const base = clampWindowSize(width, height);
  if (!monitorSize) return base;

  const limit = monitorCanComfortablyFitPreferredWindow(monitorSize)
    ? RESTORED_WINDOW_LIMIT
    : COMPACT_RESTORED_WINDOW_LIMIT;
  const isOversized =
    base.width > monitorSize.width * limit ||
    base.height > monitorSize.height * limit;
  return isOversized ? getFirstLaunchWindowSizeForMonitor(monitorSize) : base;
}
