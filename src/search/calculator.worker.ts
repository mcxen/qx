/**
 * Off-main-thread calculator evaluator.
 * Host sends { id, input }; worker replies { id, result }.
 */

import { calculateExpression, type CalculationResult } from "./calculator";

export interface CalculatorWorkerRequest {
  id: number;
  input: string;
}

export interface CalculatorWorkerResponse {
  id: number;
  result: CalculationResult | null;
}

const workerScope = self as unknown as {
  postMessage: (message: CalculatorWorkerResponse) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<CalculatorWorkerRequest>) => void,
  ) => void;
};

workerScope.addEventListener("message", (event) => {
  const { id, input } = event.data;
  let result: CalculationResult | null = null;
  try {
    result = calculateExpression(input);
  } catch {
    result = null;
  }
  workerScope.postMessage({ id, result });
});
