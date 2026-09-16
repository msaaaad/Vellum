import { describe, expect, it } from 'vitest';
import type { ChainRow, VerifyResult } from '@vellum/core';
import { buildManifest } from './manifest.js';

function fakeRow(seq: number): ChainRow {
  return {
    tenantId: 't1',
    seq,
    occurredAt: '2026-01-01T00:00:00.000Z',
    actor: { id: 'u1', type: 'user', label: null },
    action: 'thing.done',
    entity: { type: 'Thing', id: null },
    changes: {},
    metadata: {},
    hashVersion: 1,
    prevHash: '0'.repeat(64),
    rowHash: 'a'.repeat(64),
  };
}

describe('buildManifest', () => {
  it('derives count from the exported events, not from verify.count', () => {
    const verify: VerifyResult = { ok: true, count: 100, head: 'a'.repeat(64) };
    const manifest = buildManifest({
      tenantId: 't1',
      from: '2026-01-01',
      to: '2026-06-30',
      events: [fakeRow(1), fakeRow(2)],
      verify,
      toolVersion: '0.0.0',
      clock: () => new Date('2026-09-16T00:00:00.000Z'),
    });

    expect(manifest.count).toBe(2);
    expect(manifest.range).toEqual({ from: '2026-01-01', to: '2026-06-30' });
    expect(manifest.headHash).toBe('a'.repeat(64));
    expect(manifest.verify).toBe(verify);
    expect(manifest.toolVersion).toBe('0.0.0');
    expect(manifest.generatedAt).toBe('2026-09-16T00:00:00.000Z');
    expect(manifest.tool).toBe('vellum');
  });

  it('carries a null headHash through from a broken full-chain verify', () => {
    const verify: VerifyResult = {
      ok: false,
      count: 10,
      head: null,
      brokenAt: 4,
      brokenReason: 'HASH',
    };
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [fakeRow(1)],
      verify,
      toolVersion: '0.0.0',
    });

    expect(manifest.headHash).toBeNull();
    expect(manifest.verify.ok).toBe(false);
  });

  it('defaults the clock to the current time', () => {
    const before = Date.now();
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [],
      verify: { ok: true, count: 0, head: null },
      toolVersion: '0.0.0',
    });
    const generatedAt = new Date(manifest.generatedAt).getTime();
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(Date.now());
  });
});
