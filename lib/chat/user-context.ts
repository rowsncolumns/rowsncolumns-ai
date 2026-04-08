import { AsyncLocalStorage } from "node:async_hooks";

export interface ChatUserContext {
  userId: string;
  organizationId?: string;
}

const storage = new AsyncLocalStorage<ChatUserContext>();

export const withChatUserContext = <T>(
  context: ChatUserContext,
  callback: () => Promise<T>,
): Promise<T> => {
  return storage.run(context, callback);
};

export const getChatUserContext = (): ChatUserContext | undefined => {
  return storage.getStore();
};

export const getChatUserId = (): string | undefined => {
  return storage.getStore()?.userId;
};

export const getChatOrganizationId = (): string | undefined => {
  return storage.getStore()?.organizationId;
};
