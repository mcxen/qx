/**
 * Host ↔ module Esc bridge.
 *
 * When focus is outside QxShell (body/document), the window-level host handler
 * in App.tsx would otherwise jump straight to the launcher and skip nested
 * module steps (e.g. RSS article list → feed list).
 *
 * Mounted modules register one `stepBack` via `useQxModuleShell`. Host calls
 * `tryModuleEscapeStep()` first; only if nobody is registered does it fall
 * through to `setTab("launcher")`.
 */

type ModuleEscapeStep = () => void;

let registered: ModuleEscapeStep | null = null;

/** Register the active module's one-step Esc cascade. Returns unregister. */
export function registerModuleEscapeStep(step: ModuleEscapeStep): () => void {
  registered = step;
  return () => {
    if (registered === step) registered = null;
  };
}

/**
 * Run the active module's Esc step when present.
 * @returns true if a module handled the step (host must not also leave the tab)
 */
export function tryModuleEscapeStep(): boolean {
  if (!registered) return false;
  registered();
  return true;
}
