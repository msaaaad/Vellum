import { GENESIS_HASH } from './constants.js';
import { toCanonicalPayload } from './canonicalize.js';
import { hashEvent } from './hash.js';
import type { AuditEvent, ChainRow } from './types.js';

export function buildEvent(overrides: Partial<AuditEvent> & { seq: number }): AuditEvent {
  return {
    hashVersion: 1,
    tenantId: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-01-01T00:00:00.000Z',
    actor: { id: '00000000-0000-4000-8000-000000000002', type: 'user', label: 'sam@x.io' },
    action: 'thing.done',
    entity: { type: 'Thing', id: '00000000-0000-4000-8000-000000000003' },
    changes: {},
    metadata: {},
    ...overrides,
  };
}

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
