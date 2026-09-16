import { parseArgs } from 'node:util';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { createPool, resolveDatabaseUrl } from '../db.js';
import { CliError } from '../errors.js';

/**
 * `vellum checkpoint --tenant <id> [--anchored-ref <ref>]` — records the current chain head
 * and prints it for manual external anchoring (ARCHITECTURE.md §7). Automated anchoring is a
 * later roadmap item; v1 is "print the hash, a human anchors it."
 */
export async function runCheckpoint(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      'anchored-ref': { type: 'string' },
      'database-url': { type: 'string' },
    },
  });

  if (!values.tenant) throw new CliError('--tenant <id> is required.');

  const pool = createPool(resolveDatabaseUrl(values['database-url']));
  try {
    const adapter = new PgStorageAdapter(pool);
    const checkpoint = await adapter.recordCheckpoint(
      values.tenant,
      values['anchored-ref'] ?? null,
    );

    console.log(`Vellum checkpoint — tenant ${checkpoint.tenantId}`);
    console.log(`  head_seq  = ${checkpoint.headSeq}`);
    console.log(`  head_hash = ${checkpoint.headHash}`);
    if (checkpoint.anchoredRef) {
      console.log(`  anchored_ref = ${checkpoint.anchoredRef}`);
    }
    console.log('');
    console.log("  Anchor head_hash somewhere this database's own role can't rewrite");
    console.log('  (WORM object storage, a signed email, a public log) — see ARCHITECTURE.md §7.');
    return 0;
  } finally {
    await pool.end();
  }
}
