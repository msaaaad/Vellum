import type { Pool } from 'pg';
import type { AuditActor } from '@vellum/core';

export interface AuditRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  route: string | null;
}

export interface AuditContext {
  tenantId: string;
  actor: AuditActor;
  requestMeta: AuditRequestMeta;
  request?: unknown;
}

export type TenantResolver = (req: unknown) => string | Promise<string>;
export type ActorResolver = (req: unknown) => AuditActor | Promise<AuditActor>;

export interface PgStorageConfig {
  adapter: 'pg';
  pool: Pool;
  schema?: string;
  table?: string;
}

export interface PrismaStorageConfig {
  adapter: 'prisma';
  client: () => unknown;
  schema?: string;
  table?: string;
}

export type AuditStorageConfig = PgStorageConfig | PrismaStorageConfig;

export interface AuditOutboxConfig {
  queueName?: string;
  connection: unknown;
  batchSize?: number;
  pollMs?: number;
}

export interface AuditModuleOptions {
  storage: AuditStorageConfig;
  mode?: 'inline' | 'outbox';
  outbox?: AuditOutboxConfig;
  tenantResolver: TenantResolver;
  actorResolver: ActorResolver;
  hash?: { algorithm?: 'sha256'; version?: number };
  redact?: string[];
  clock?: () => Date;
  onError?: (err: unknown, event: unknown) => void;
}

export interface AuditPointcut<TArgs extends unknown[] = unknown[], TResult = unknown> {
  args: TArgs;
  result: TResult;
  self: unknown;
  request?: unknown;
  tenantId: string;
  actor: AuditActor;
}

export type CaptureMode = 'snapshot' | 'diff' | 'none';

export interface AuditedOptions {
  action: string;
  entity: string;
  entityId?: (c: AuditPointcut) => string | null | undefined;
  capture?: CaptureMode;
  loadBefore?: (c: AuditPointcut) => unknown | Promise<unknown>;
  redact?: string[];
  metadata?: (c: AuditPointcut) => Record<string, unknown> | undefined;
}

export interface RecordEventInput {
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
  metadata?: Record<string, unknown>;
}
