import { describe, expect, it } from 'vitest';
import { verifyChain } from './verify.js';
import { buildChain, buildEvent } from './test-helpers.js';

function threeRowChain() {
  return buildChain([
    buildEvent({ seq: 1, action: 'tenant.created' }),
    buildEvent({ seq: 2, action: 'participant.created' }),
    buildEvent({ seq: 3, action: 'participant.updated' }),
  ]);
}

describe('verifyChain', () => {
  it('returns ok for an empty chain', () => {
    expect(verifyChain([])).toEqual({ ok: true, count: 0, head: null });
  });

  it('verifies INTACT on a valid hand-built 3-row chain', () => {
    const rows = threeRowChain();
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.head).toBe(rows[2]!.rowHash);
  });

  it('fails at seq 2 when row 2 is mutated (tamper detection)', () => {
    const rows = threeRowChain();
    rows[1] = { ...rows[1]!, action: 'participant.deleted' }; // row_hash no longer matches

    const result = verifyChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.brokenReason).toBe('HASH');
  });

  it('detects a deleted row as a sequence gap', () => {
    const rows = threeRowChain();
    rows.splice(1, 1); // delete seq 2, leaving [1, 3]

    const result = verifyChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.brokenReason).toBe('GAP');
  });

  it('detects reordered rows as a broken link', () => {
    const rows = threeRowChain();
    [rows[0], rows[1]] = [rows[1]!, rows[0]!]; // swap seq 1 and seq 2 positions

    const result = verifyChain(rows);

    expect(result.ok).toBe(false);
    // seq check fires first since row order no longer matches ascending seq.
    expect(result.brokenAt).toBe(1);
    expect(result.brokenReason).toBe('GAP');
  });

  it('detects a broken link when prev_hash is forged to skip tampering', () => {
    const rows = threeRowChain();
    // Break the link directly without breaking seq contiguity or recomputable hash pairing.
    rows[1] = { ...rows[1]!, prevHash: '1'.repeat(64) };

    const result = verifyChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.brokenReason).toBe('LINK');
  });

  it('verifies a ranged slice by trusting the first row prev_hash as anchor', () => {
    const rows = threeRowChain();
    const result = verifyChain(rows.slice(1), { fromSeq: 2 });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.head).toBe(rows[2]!.rowHash);
  });
});
