import { GENESIS_HASH } from './constants.js';
import { toCanonicalPayload } from './canonicalize.js';
import { hashEvent } from './hash.js';
import type { ChainRow, VerifyResult } from './types.js';

export interface VerifyChainOptions {
  /** Set when verifying a ranged slice; the first row's prev_hash is trusted as the anchor. */
  fromSeq?: number;
}

/**
 * Recomputes every hash and checks the chain is contiguous and unbroken —
 * ARCHITECTURE.md §6. `rows` must already be ordered by seq ascending.
 */
export function verifyChain(rows: ChainRow[], options: VerifyChainOptions = {}): VerifyResult {
  if (rows.length === 0) {
    return { ok: true, count: 0, head: null };
  }

  const { fromSeq } = options;
  let expectSeq = fromSeq ?? 1;
  let expectPrev = fromSeq !== undefined && fromSeq > 1 ? rows[0]!.prevHash : GENESIS_HASH;

  for (const row of rows) {
    if (row.seq !== expectSeq) {
      return { ok: false, count: rows.length, head: null, brokenAt: expectSeq, brokenReason: 'GAP' };
    }
    if (row.prevHash !== expectPrev) {
      return { ok: false, count: rows.length, head: null, brokenAt: row.seq, brokenReason: 'LINK' };
    }

    const recomputed = hashEvent(row.prevHash, toCanonicalPayload(row));
    if (recomputed !== row.rowHash) {
      return { ok: false, count: rows.length, head: null, brokenAt: row.seq, brokenReason: 'HASH' };
    }

    expectPrev = row.rowHash;
    expectSeq += 1;
  }

  return { ok: true, count: rows.length, head: rows[rows.length - 1]!.rowHash };
}
