import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditContext } from './types.js';

const auditContextStorage = new AsyncLocalStorage<AuditContext>();

export function withAuditContext<TResult>(auditContext: AuditContext, callback: () => TResult): TResult {
  return auditContextStorage.run(auditContext, callback);
}

export function getAuditContext(): AuditContext | undefined {
  return auditContextStorage.getStore();
}
