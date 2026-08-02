import { describe, expect, it } from 'vitest';
import { canonicalizePayload, normalizeOccurredAt, toCanonicalPayload } from './canonicalize.js';
import { buildEvent } from './test-helpers.js';

describe('normalizeOccurredAt', () => {
  it('normalizes to UTC with exactly 3 fractional digits', () => {
    expect(normalizeOccurredAt('2026-07-20T04:21:07.1Z')).toBe('2026-07-20T04:21:07.100Z');
    expect(normalizeOccurredAt('2026-07-20T04:21:07Z')).toBe('2026-07-20T04:21:07.000Z');
  });

  it('normalizes non-UTC offsets to UTC', () => {
    expect(normalizeOccurredAt('2026-07-20T14:21:07+10:00')).toBe('2026-07-20T04:21:07.000Z');
  });

  it('throws on an unparseable timestamp', () => {
    expect(() => normalizeOccurredAt('not-a-date')).toThrow(/Invalid occurred_at/);
  });
});

describe('toCanonicalPayload', () => {
  it('fills absent optionals with null instead of omitting them', () => {
    const payload = toCanonicalPayload(
      buildEvent({ seq: 1, actor: { id: null, type: 'system', label: null }, entity: { type: 'Tenant', id: null } }),
    );
    expect(payload.actor).toEqual({ id: null, type: 'system', label: null });
    expect(payload.entity).toEqual({ type: 'Tenant', id: null });
  });

  it('carries hash_version through as v', () => {
    const payload = toCanonicalPayload(buildEvent({ seq: 1, hashVersion: 1 }));
    expect(payload.v).toBe(1);
  });
});

describe('canonicalizePayload (JCS)', () => {
  it('sorts keys regardless of input construction order', () => {
    const a = toCanonicalPayload(buildEvent({ seq: 1 }));
    // Same values, deliberately re-assembled with a different key order.
    const b = {
      metadata: a.metadata,
      changes: a.changes,
      entity: { id: a.entity.id, type: a.entity.type },
      action: a.action,
      actor: { label: a.actor.label, id: a.actor.id, type: a.actor.type },
      occurred_at: a.occurred_at,
      seq: a.seq,
      tenant_id: a.tenant_id,
      v: a.v,
    };

    expect(canonicalizePayload(b)).toBe(canonicalizePayload(a));
  });

  it('produces no insignificant whitespace', () => {
    const payload = toCanonicalPayload(buildEvent({ seq: 1 }));
    expect(canonicalizePayload(payload)).not.toMatch(/[\n\t]| : | ,/);
  });
});
