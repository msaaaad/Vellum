import type { Pool } from 'pg';
import { verifyChain, type ChainRow, type VerifyResult } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';

/** README "chain: verified ✓ / tampered ✗" badge — a full-chain verify, exactly what `vellum
 * verify` does, over the same RLS-scoped pool the rest of the dashboard reads through. */
export async function verifyTenantChain(pool: Pool, tenantId: string): Promise<VerifyResult> {
  const adapter = new PgStorageAdapter(pool);
  const rows = await adapter.readRange(tenantId);
  return verifyChain(rows);
}

export async function readTenantChain(pool: Pool, tenantId: string): Promise<ChainRow[]> {
  const adapter = new PgStorageAdapter(pool);
  return adapter.readRange(tenantId);
}
