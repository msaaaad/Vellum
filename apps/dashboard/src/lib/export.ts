import type { Pool } from 'pg';
import { verifyChain, type ChainRow } from '@vellum/core';
import { buildManifest, getToolVersion, type ExportManifest } from '@vellum/cli/evidence-pack';
import { readTenantChain } from './verify';

/**
 * README "One-click evidence-pack export" — the exact same manifest `vellum export` builds
 * (`@vellum/cli/evidence-pack`, Phase 5's own logic, not a second implementation): a full-chain
 * verify, stamped on the pack, covering the tenant's complete history.
 */
export async function buildTenantEvidencePack(
  pool: Pool,
  tenantId: string,
): Promise<{ manifest: ExportManifest; events: ChainRow[] }> {
  const events = await readTenantChain(pool, tenantId);
  const verify = verifyChain(events);
  const manifest = buildManifest({
    tenantId,
    from: null,
    to: null,
    events,
    verify,
    toolVersion: getToolVersion(),
  });
  return { manifest, events };
}
