import jcsCanonicalize from 'canonicalize';
import type { AuditEvent, CanonicalPayload } from './types.js';

export function normalizeOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid occurred_at: ${occurredAt}`);
  }
  return date.toISOString();
}

export function toCanonicalPayload(event: AuditEvent): CanonicalPayload {
  return {
    v: event.hashVersion,
    tenant_id: event.tenantId,
    seq: event.seq,
    occurred_at: normalizeOccurredAt(event.occurredAt),
    actor: {
      id: event.actor.id ?? null,
      type: event.actor.type,
      label: event.actor.label ?? null,
    },
    action: event.action,
    entity: {
      type: event.entity.type,
      id: event.entity.id ?? null,
    },
    changes: event.changes ?? {},
    metadata: event.metadata ?? {},
  };
}

export function canonicalizePayload(payload: CanonicalPayload): string {
  const canonicalJson = jcsCanonicalize(payload);
  if (canonicalJson === undefined) {
    throw new Error('Failed to canonicalize payload: input is not JSON-serializable');
  }
  return canonicalJson;
}
