import { createContext, useContext } from "react";
import type { QxShellAction } from "./actionProtocol";

export const ActionExecutionContext = createContext<{
  run: (action: QxShellAction) => void;
  isPending: (action: QxShellAction) => boolean;
} | null>(null);

export function useActionExecution() {
  return useContext(ActionExecutionContext);
}
