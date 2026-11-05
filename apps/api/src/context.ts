import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId?: number;
  role?: string;
  ip?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentUserId(): number | undefined {
  return requestContext.getStore()?.userId;
}

export function currentIp(): string | undefined {
  return requestContext.getStore()?.ip;
}
