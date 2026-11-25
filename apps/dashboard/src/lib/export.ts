import type { Pool } from 'pg';
import { verifyChain, type ChainRow } from '@vellum/core';
import { buildManifest, getToolVersion, type ExportManifest } from '@vellum/cli/evidence-pack';
import { readTenantChain } from './verify';

export async function buildTenantEvidencePack(
  pool: Pool,
  tenantId: string,
): Promise<{ manifest: ExportManifest; events: ChainRow[] }> {
  const events = await readTenantChain(pool, tenantId);
  const verifyResult = verifyChain(events);
  const manifest = buildManifest({
    tenantId,
    from: null,
    to: null,
    events,
    verify: verifyResult,
    toolVersion: getToolVersion(),
  });
  return { manifest, events };
}
