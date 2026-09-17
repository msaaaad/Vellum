/** DI token for the resolved {@link AuditModuleOptions} passed to `forRoot`/`forRootAsync`. */
export const AUDIT_MODULE_OPTIONS = Symbol('vellum:audit-module-options');

/** DI token for the `StoragePort` instance built from `options.storage` — see `storage.ts`. */
export const AUDIT_STORAGE = Symbol('vellum:audit-storage');

/** Reflect-metadata key `@Audited()` writes to — for external introspection only; the decorator's
 * own write path doesn't read it back (see decorator.ts's doc comment). */
export const AUDITED_METADATA_KEY = 'vellum:audited';
