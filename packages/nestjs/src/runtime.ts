import type { AuditWriter } from './audit-writer.service.js';

let active: AuditWriter | undefined;

/**
 * A module-level singleton (not DI) holding the active `AuditWriter` — set once, from
 * `AuditWriter`'s own constructor, deliberately mirroring `context.ts`'s AsyncLocalStorage
 * (also module-level, not DI): `@Audited()` wraps the decorated method itself so it works for a
 * directly-called service method, not only a controller handler Nest's HTTP/RPC dispatch
 * invokes (see `decorator.ts`'s doc comment for why that distinction matters) — which means the
 * wrapper runs with no access to Nest's injector at all. This is the one other piece it needs.
 *
 * One active writer per process: exactly matches `AuditModule` being `@Global()` — a real app
 * calls `forRoot()`/`forRootAsync()` once. Tests that construct more than one `AuditWriter` in
 * the same file (different config per test) just get "whichever was constructed most recently",
 * which is correct as long as construction happens before the decorated call it backs — true by
 * construction in every test in this repo (build the writer/module, then call the service).
 */
export function setActiveAuditWriter(writer: AuditWriter): void {
  active = writer;
}

export function getActiveAuditWriter(): AuditWriter {
  if (!active) {
    throw new Error(
      'No AuditModule is active — import AuditModule.forRoot()/forRootAsync() in your ' +
        'application before calling an @Audited() method (in a test, resolving any of its ' +
        "providers via the testing module's DI container at least once is enough).",
    );
  }
  return active;
}
