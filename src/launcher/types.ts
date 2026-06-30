export interface QuickEntry {
  id: string;
  title: string;
  subtitle: string;
  target: string;
  onClick: () => void;
}

export interface LauncherAction {
  id: string;
  label: string;
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}
