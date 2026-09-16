import { describe, expect, it } from 'vitest';
import type { VerifyResult } from '@vellum/core';
import { formatVerifyReport, shortHash } from './format.js';

describe('shortHash', () => {
  it('shows the first 6 and last 4 hex characters', () => {
    const hash = '9f2c3ea1b2c3d4e5f60718293a4b5c6d7e8f9012131415161718191a1b1c1d1';
    expect(shortHash(hash)).toBe(`${hash.slice(0, 6)}…${hash.slice(-4)}`);
  });
});

describe('formatVerifyReport', () => {
  it('reports INTACT with the shortened head hash', () => {
    const result: VerifyResult = { ok: true, count: 3, head: 'a'.repeat(64) };
    const report = formatVerifyReport('t1', result, '2026-09-16T00:00:00.000Z');
    expect(report).toContain('Vellum verify — tenant t1  (3 events)');
    expect(report).toContain('RESULT: INTACT');
    expect(report).toContain(shortHash('a'.repeat(64)));
    expect(report).toContain('verified_at = 2026-09-16T00:00:00.000Z');
  });

  it('uses singular "event" for a single-row chain', () => {
    const result: VerifyResult = { ok: true, count: 1, head: 'a'.repeat(64) };
    expect(formatVerifyReport('t1', result, 'now')).toContain('(1 event)');
  });

  it('reports an empty chain as INTACT with no head', () => {
    const result: VerifyResult = { ok: true, count: 0, head: null };
    expect(formatVerifyReport('t1', result, 'now')).toContain('head = (empty chain)');
  });

  it('reports TAMPERED with the seq and reason for a HASH break', () => {
    const result: VerifyResult = {
      ok: false,
      count: 5,
      head: null,
      brokenAt: 3,
      brokenReason: 'HASH',
    };
    const report = formatVerifyReport('t1', result, 'now');
    expect(report).toContain('✗ BROKEN at seq 3');
    expect(report).toContain('row_hash at seq 3 ≠ recomputed row_hash');
    expect(report).toContain('RESULT: TAMPERED');
  });

  it('reports TAMPERED with a GAP-specific message', () => {
    const result: VerifyResult = {
      ok: false,
      count: 5,
      head: null,
      brokenAt: 4,
      brokenReason: 'GAP',
    };
    expect(formatVerifyReport('t1', result, 'now')).toContain('sequence gap at seq 4');
  });

  it('reports TAMPERED with a LINK-specific message', () => {
    const result: VerifyResult = {
      ok: false,
      count: 5,
      head: null,
      brokenAt: 2,
      brokenReason: 'LINK',
    };
    expect(formatVerifyReport('t1', result, 'now')).toContain(
      "doesn't match the previous row's row_hash",
    );
  });
});
