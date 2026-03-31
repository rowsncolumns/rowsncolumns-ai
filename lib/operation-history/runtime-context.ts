import { AsyncLocalStorage } from "node:async_hooks";

export interface OperationHistoryRuntimeContext {
  userId?: string;
  trackingAllowed?: boolean;
}

const operationHistoryContextStorage =
  new AsyncLocalStorage<OperationHistoryRuntimeContext>();

export function withOperationHistoryRuntimeContext<T>(
  context: OperationHistoryRuntimeContext,
  callback: () => Promise<T>
): Promise<T> {
  return operationHistoryContextStorage.run(context, callback);
}

export function getOperationHistoryRuntimeContext():
  | OperationHistoryRuntimeContext
  | undefined {
  return operationHistoryContextStorage.getStore();
}
