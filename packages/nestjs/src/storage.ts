import { PgStorageAdapter } from '@vellum/storage-pg';
import type { StoragePort } from '@vellum/core';
import type { AuditModuleOptions } from './types.js';

/** Builds the `StoragePort` the rest of the module writes through, from `options.storage`. */
export function buildStorage(options: AuditModuleOptions): StoragePort<unknown> {
  const { storage } = options;

  if (storage.adapter === 'pg') {
    if (!storage.pool) {
      throw new Error(
        "AuditModule: storage.adapter 'pg' requires storage.pool (a node-postgres Pool).",
      );
    }
    return new PgStorageAdapter(storage.pool) as StoragePort<unknown>;
  }

  if (storage.adapter === 'prisma') {
    throw new Error(
      "AuditModule: storage.adapter 'prisma' isn't implemented yet — @vellum/storage-prisma ships " +
        "later (see DOMAIN_CHECKLIST.md Phase 9). Use adapter: 'pg' for now.",
    );
  }

  const unknownAdapter: string = (storage as { adapter: string }).adapter;
  throw new Error(`AuditModule: unknown storage.adapter '${unknownAdapter}'`);
}
