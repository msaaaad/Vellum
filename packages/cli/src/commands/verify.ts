import { parseArgs } from 'node:util';
import { verifyChain } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { createPool, resolveDatabaseUrl } from '../db.js';
import { CliError } from '../errors.js';
import { formatVerifyReport } from '../format.js';

function parseSeq(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(`${flag} must be a positive integer sequence number, got '${raw}'.`);
  }
  return n;
}

/**
 * `vellum verify --tenant <id> [--from --to] [--json]` — README "Verifying integrity".
 * Exit code 0 for an intact chain, 1 for a tampered one — CI/script-friendly.
 */
export async function runVerify(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      json: { type: 'boolean', default: false },
      'database-url': { type: 'string' },
    },
  });

  if (!values.tenant) throw new CliError('--tenant <id> is required.');
  const fromSeq = values.from !== undefined ? parseSeq(values.from, '--from') : undefined;
  const toSeq = values.to !== undefined ? parseSeq(values.to, '--to') : undefined;

  const pool = createPool(resolveDatabaseUrl(values['database-url']));
  try {
    const adapter = new PgStorageAdapter(pool);
    const rows = await adapter.readRange(values.tenant, { fromSeq, toSeq });
    // A ranged verify trusts the first row's prev_hash as the anchor (ARCHITECTURE.md §6) —
    // pass the same fromSeq through so verifyChain knows this isn't a full-chain check.
    const result = verifyChain(rows, { fromSeq });
    const verifiedAt = new Date().toISOString();

    if (values.json) {
      console.log(JSON.stringify({ tenantId: values.tenant, verifiedAt, ...result }, null, 2));
    } else {
      console.log(formatVerifyReport(values.tenant, result, verifiedAt));
    }

    return result.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}
