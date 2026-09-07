import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditContext } from './types.js';

/**
 * A single module-level store (not a DI service) so it works identically for HTTP requests
 * (`AuditContextMiddleware`) and non-HTTP work (jobs, CLI, seeds) that never touch DI —
 * ARCHITECTURE.md §4.1.
 */
const als = new AsyncLocalStorage<AuditContext>();

/**
 * Runs `fn` with `ctx` available to everything downstream (the interceptor, `AuditService`)
 * via {@link getAuditContext}. Use this to wrap non-HTTP work — jobs, CLI commands, seed
 * scripts — with `actor.type: 'system'` where there's no HTTP request to derive it from.
 */
export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** The current request's audit context, or `undefined` outside any `withAuditContext` block. */
export function getAuditContext(): AuditContext | undefined {
  return als.getStore();
}
