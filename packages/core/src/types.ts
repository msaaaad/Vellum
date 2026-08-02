export type ActorType = 'user' | 'system' | 'api_key' | 'anonymous';

export interface AuditActor {
  id: string | null;
  type: ActorType;
  label: string | null;
}

export interface AuditEntity {
  type: string;
  id: string | null;
}

/** The fields needed to canonicalize and hash one chain row. */
export interface AuditEvent {
  hashVersion: number;
  tenantId: string;
  seq: number;
  /** RFC3339 timestamp; normalized to UTC millisecond precision before hashing. */
  occurredAt: string;
  actor: AuditActor;
  action: string;
  entity: AuditEntity;
  changes: unknown;
  metadata: unknown;
}

/** A stored chain row: an AuditEvent plus the hashes that link it into the chain. */
export interface ChainRow extends AuditEvent {
  prevHash: string;
  rowHash: string;
}

/**
 * The exact object hashed for a row — ARCHITECTURE.md §3.1.
 * Key set is fixed; absent optionals are `null`, never omitted.
 */
export interface CanonicalPayload {
  v: number;
  tenant_id: string;
  seq: number;
  occurred_at: string;
  actor: { id: string | null; type: ActorType; label: string | null };
  action: string;
  entity: { type: string; id: string | null };
  changes: unknown;
  metadata: unknown;
}

export type BrokenReason = 'GAP' | 'LINK' | 'HASH';

export interface VerifyResult {
  ok: boolean;
  count: number;
  head: string | null;
  brokenAt?: number;
  brokenReason?: BrokenReason;
}
