import { AsyncLocalStorage } from "node:async_hooks";
import type { McpTokenPermission } from "./mcp-token";

export interface ShareDbRuntimeContext {
  mcpTokenFactory?: (input: {
    docId: string;
    permission: McpTokenPermission;
  }) => Promise<string | null>;
}

const storage = new AsyncLocalStorage<ShareDbRuntimeContext>();

export const withShareDbRuntimeContext = <T>(
  context: ShareDbRuntimeContext,
  callback: () => Promise<T>,
): Promise<T> => {
  return storage.run(context, callback);
};

export const getShareDbRuntimeContext = (): ShareDbRuntimeContext | undefined => {
  return storage.getStore();
};
