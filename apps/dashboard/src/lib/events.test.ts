import { describe, expect, it } from 'vitest';
import { buildEventsQuery, DEFAULT_PAGE_SIZE } from './events';

describe('buildEventsQuery', () => {
  it('always scopes to the tenant, with no other filters applied', () => {
    const { sql, params } = buildEventsQuery('t1', {});
    expect(sql).toContain('WHERE tenant_id = $1');
    expect(sql).not.toContain('entity_type');
    expect(sql).not.toContain('actor_id');
    expect(sql).not.toContain('action =');
    expect(params).toEqual(['t1', DEFAULT_PAGE_SIZE, 0]);
  });

  it('adds an entity_type condition when given', () => {
    const { sql, params } = buildEventsQuery('t1', { entityType: 'Participant' });
    expect(sql).toContain('entity_type = $2');
    expect(params).toEqual(['t1', 'Participant', DEFAULT_PAGE_SIZE, 0]);
  });

  it('combines entity/actor/action/date filters, in a stable parameter order', () => {
    const { sql, params } = buildEventsQuery('t1', {
      entityType: 'Consent',
      actorId: 'u1',
      action: 'consent.granted',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
    });

    expect(sql).toContain('entity_type = $2');
    expect(sql).toContain('actor_id = $3');
    expect(sql).toContain('action = $4');
    expect(sql).toContain('occurred_at >= $5');
    expect(sql).toContain('occurred_at <= $6');
    expect(params).toEqual([
      't1',
      'Consent',
      'u1',
      'consent.granted',
      '2026-01-01T00:00:00.000Z',
      '2026-06-30T23:59:59.999Z',
      DEFAULT_PAGE_SIZE,
      0,
    ]);
  });

  it('orders by seq descending — most recent first', () => {
    const { sql } = buildEventsQuery('t1', {});
    expect(sql).toContain('ORDER BY seq DESC');
  });

  it('respects a custom limit/offset', () => {
    const { sql, params } = buildEventsQuery('t1', { limit: 10, offset: 20 });
    expect(sql).toMatch(/LIMIT \$2 OFFSET \$3/);
    expect(params).toEqual(['t1', 10, 20]);
  });

  it('ignores empty-string filter values, same as absent ones', () => {
    const { sql } = buildEventsQuery('t1', { entityType: '', actorId: undefined });
    expect(sql).not.toContain('entity_type');
    expect(sql).not.toContain('actor_id');
  });
});
