import { describe, expect, it } from 'vitest';
import type { ChainRow } from '@vellum/core';
import { filterByDate, parseDateBoundary } from './export.js';

function fakeRow(occurredAt: string): ChainRow {
  return {
    tenantId: 't1',
    seq: 1,
    occurredAt,
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

describe('parseDateBoundary', () => {
  it('treats a bare date as midnight UTC for the start edge', () => {
    expect(parseDateBoundary('2026-06-01', 'start')).toBe('2026-06-01T00:00:00.000Z');
  });

  it('treats a bare date as the last millisecond of the day for the end edge — inclusive of the whole day', () => {
    expect(parseDateBoundary('2026-06-30', 'end')).toBe('2026-06-30T23:59:59.999Z');
  });

  it('passes a full timestamp through as-is (normalized)', () => {
    expect(parseDateBoundary('2026-06-01T12:30:00Z', 'start')).toBe('2026-06-01T12:30:00.000Z');
  });

  it('rejects an unparseable date', () => {
    expect(() => parseDateBoundary('not-a-date', 'start')).toThrow(/invalid date/);
  });
});

describe('filterByDate', () => {
  const rows = [
    fakeRow('2026-01-15T00:00:00.000Z'),
    fakeRow('2026-03-01T00:00:00.000Z'),
    fakeRow('2026-06-30T23:59:59.999Z'),
  ];

  it('returns everything when no bounds are given', () => {
    expect(filterByDate(rows, null, null)).toHaveLength(3);
  });

  it('excludes rows before `from`', () => {
    const filtered = filterByDate(rows, '2026-02-01T00:00:00.000Z', null);
    expect(filtered.map((r) => r.occurredAt)).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-06-30T23:59:59.999Z',
    ]);
  });

  it('excludes rows after `to`', () => {
    const filtered = filterByDate(rows, null, '2026-03-01T00:00:00.000Z');
    expect(filtered.map((r) => r.occurredAt)).toEqual([
      '2026-01-15T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
  });

  it('is inclusive of both boundaries', () => {
    const filtered = filterByDate(rows, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z');
    expect(filtered).toHaveLength(1);
  });
});
