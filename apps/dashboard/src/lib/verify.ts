import type { Pool } from 'pg';
import { verifyChain, type ChainRow, type VerifyResult } from '@getattestly/core';
import { PgStorageAdapter } from '@getattestly/storage-pg';

export async function verifyTenantChain(pool: Pool, tenantId: string): Promise<VerifyResult> {
  const adapter = new PgStorageAdapter(pool);
  const rows = await adapter.readRange(tenantId);
  return verifyChain(rows);
}

export async function readTenantChain(pool: Pool, tenantId: string): Promise<ChainRow[]> {
  const adapter = new PgStorageAdapter(pool);
  return adapter.readRange(tenantId);
}
