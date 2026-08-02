import jcsCanonicalize from 'canonicalize';
import type { AuditEvent, CanonicalPayload } from './types.js';

/**
 * `Date#toISOString()` always emits exactly 3 fractional-second digits and 'Z',
 * so it doubles as the UTC-ms normalization ARCHITECTURE.md §3.2 requires.
 */
export function normalizeOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid occurred_at: ${occurredAt}`);
  }
  return date.toISOString();
}

/** Builds the fixed-key-set object that gets hashed — ARCHITECTURE.md §3.1. */
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

/** RFC 8785 JSON Canonicalization Scheme: sorted keys, no whitespace, canonical numbers. */
export function canonicalizePayload(payload: CanonicalPayload): string {
  const result = jcsCanonicalize(payload);
  if (result === undefined) {
    throw new Error('Failed to canonicalize payload: input is not JSON-serializable');
  }
  return result;
}
