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

export interface AuditEvent {
  hashVersion: number;
  tenantId: string;
  seq: number;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  entity: AuditEntity;
  changes: unknown;
  metadata: unknown;
}

export interface ChainRow extends AuditEvent {
  prevHash: string;
  rowHash: string;
}

export type PendingAuditEvent = Omit<AuditEvent, 'seq'>;

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
