import { createHash } from 'node:crypto';
import jcsCanonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from './constants.js';
import { toCanonicalPayload } from './canonicalize.js';
import { hashEvent } from './hash.js';
import { buildEvent } from './test-helpers.js';

describe('hashEvent', () => {
  it('is deterministic: identical payload -> identical hash', () => {
    const payload = toCanonicalPayload(buildEvent({ seq: 1 }));
    expect(hashEvent(GENESIS_HASH, payload)).toBe(hashEvent(GENESIS_HASH, payload));
  });

  it('is deterministic across independently-built but equal payloads', () => {
    const a = toCanonicalPayload(buildEvent({ seq: 1 }));
    const b = toCanonicalPayload(buildEvent({ seq: 1 }));
    expect(hashEvent(GENESIS_HASH, a)).toBe(hashEvent(GENESIS_HASH, b));
  });

  it('changes the hash when any field changes', () => {
    const base = hashEvent(GENESIS_HASH, toCanonicalPayload(buildEvent({ seq: 1 })));

    const differentAction = hashEvent(
      GENESIS_HASH,
      toCanonicalPayload(buildEvent({ seq: 1, action: 'thing.other' })),
    );
    const differentMetadata = hashEvent(
      GENESIS_HASH,
      toCanonicalPayload(buildEvent({ seq: 1, metadata: { note: 'x' } })),
    );
    const differentPrevHash = hashEvent('1'.repeat(64), toCanonicalPayload(buildEvent({ seq: 1 })));

    expect(differentAction).not.toBe(base);
    expect(differentMetadata).not.toBe(base);
    expect(differentPrevHash).not.toBe(base);
  });

  it('produces a lowercase 64-char hex digest', () => {
    const digest = hashEvent(GENESIS_HASH, toCanonicalPayload(buildEvent({ seq: 1 })));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the worked genesis example from ARCHITECTURE.md §3.4', () => {
    const payload = toCanonicalPayload(
      buildEvent({
        seq: 1,
        tenantId: 't1',
        occurredAt: '2026-07-20T00:00:00.000Z',
        actor: { id: null, type: 'system', label: null },
        action: 'tenant.created',
        entity: { type: 'Tenant', id: 't1' },
        changes: {},
        metadata: {},
      }),
    );
    const expected = createHash('sha256')
      .update(GENESIS_HASH + '\n' + jcsCanonicalize(payload), 'utf8')
      .digest('hex');

    expect(hashEvent(GENESIS_HASH, payload)).toBe(expected);
  });

  it('throws on an unsupported hash_version', () => {
    const payload = toCanonicalPayload(buildEvent({ seq: 1, hashVersion: 99 }));
    expect(() => hashEvent(GENESIS_HASH, payload)).toThrow(/Unsupported hash_version: 99/);
  });
});
