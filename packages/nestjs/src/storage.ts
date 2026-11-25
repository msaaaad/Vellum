import { PgStorageAdapter } from '@attestly/storage-pg';
import { PrismaStorageAdapter, type PrismaLike } from '@attestly/storage-prisma';
import type { StoragePort } from '@attestly/core';
import type { AuditModuleOptions } from './types.js';

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
    const client = storage.client?.() as PrismaLike | undefined;
    if (!client || typeof client.$transaction !== 'function') {
      throw new Error(
        "AuditModule: storage.adapter 'prisma' requires storage.client to return a PrismaClient.",
      );
    }
    return new PrismaStorageAdapter(client) as StoragePort<unknown>;
  }

  const unknownAdapter: string = (storage as { adapter: string }).adapter;
  throw new Error(`AuditModule: unknown storage.adapter '${unknownAdapter}'`);
}
