export interface QuickEntry {
  id: string;
  title: string;
  subtitle: string;
  target: string;
  beta?: boolean;
  onClick: () => void;
}

export interface LauncherAction {
  id: string;
  label: string;
  kbd?: string;
  /**
   * Single letter while the Action menu is open (Raycast-style), e.g. "p" pin.
   * Never Space — host/launcher chords own that.
   */
  menuKey?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}
