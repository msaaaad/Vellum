import { GENESIS_HASH } from './constants.js';
import { toCanonicalPayload } from './canonicalize.js';
import { hashEvent } from './hash.js';
import type { AuditEvent, ChainRow } from './types.js';

/** A valid minimal event, with per-test overrides (seq is required — nothing sane defaults it). */
export function buildEvent(overrides: Partial<AuditEvent> & { seq: number }): AuditEvent {
  return {
    hashVersion: 1,
    tenantId: 't1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    actor: { id: 'u1', type: 'user', label: 'sam@x.io' },
    action: 'thing.done',
    entity: { type: 'Thing', id: 't-1' },
    changes: {},
    metadata: {},
    ...overrides,
  };
}

/** Hand-chains a list of events into rows, exactly as an append-only writer would. */
export function buildChain(events: AuditEvent[]): ChainRow[] {
  const rows: ChainRow[] = [];
  let prevHash = GENESIS_HASH;
  for (const event of events) {
    const rowHash = hashEvent(prevHash, toCanonicalPayload(event));
    rows.push({ ...event, prevHash, rowHash });
    prevHash = rowHash;
  }
  return rows;
}
