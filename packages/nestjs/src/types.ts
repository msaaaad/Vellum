import type { Pool } from 'pg';
import type { AuditActor } from '@vellum/core';

/** Request metadata `AuditContextMiddleware` collects automatically — ARCHITECTURE.md §4.1. */
export interface AuditRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  route: string | null;
}

/**
 * What lives in `AsyncLocalStorage` for the duration of a request (or a `withAuditContext`
 * block) — everything downstream (`AuditInterceptor`, `AuditService`) reads tenant/actor from
 * here instead of taking them as parameters, so `tenantId` is never passed by hand.
 */
export interface AuditContext {
  tenantId: string;
  actor: AuditActor;
  requestMeta: AuditRequestMeta;
  /** The originating HTTP request, if this context came from `AuditContextMiddleware`. */
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

/**
 * Outbox worker config, consumed by `AuditOutboxWorker` (Phase 4). `connection` is `unknown`
 * here on purpose — it's really BullMQ's `ConnectionOptions` (ioredis options or an ioredis
 * instance), but this public type surface stays framework-agnostic the same way `packages/core`
 * does, so an inline-mode-only consumer never needs `bullmq`'s types resolvable at all. The
 * worker casts it internally, where it already unconditionally depends on `bullmq`.
 */
export interface AuditOutboxConfig {
  queueName?: string;
  connection: unknown;
  batchSize?: number;
  pollMs?: number;
}

export interface AuditModuleOptions {
  storage: AuditStorageConfig;
  /** @default 'inline' */
  mode?: 'inline' | 'outbox';
  /** Required when `mode: 'outbox'` (Phase 4). */
  outbox?: AuditOutboxConfig;
  tenantResolver: TenantResolver;
  actorResolver: ActorResolver;
  hash?: { algorithm?: 'sha256'; version?: number };
  /** Field paths (dot-separated) stripped from `changes`/`metadata` before hashing, globally. */
  redact?: string[];
  /** Injectable clock, e.g. a fixed one in tests. @default () => new Date() */
  clock?: () => Date;
  /** Called instead of throwing when a write fails (inline mode only — never silently drop). */
  onError?: (err: unknown, event: unknown) => void;
}

/**
 * What a resolver on `@Audited()` receives — README "The @Audited() decorator". `result` is
 * `undefined` while `loadBefore` runs (the handler hasn't executed yet) and set afterwards.
 */
export interface AuditPointcut<TArgs extends unknown[] = unknown[], TResult = unknown> {
  args: TArgs;
  result: TResult;
  /** The controller/service instance, resolved via `ModuleRef` (assumes default/singleton scope). */
  self: unknown;
  request?: unknown;
  tenantId: string;
  actor: AuditActor;
}

export type CaptureMode = 'snapshot' | 'diff' | 'none';

export interface AuditedOptions {
  /** Dot-namespaced event name, e.g. `'participant.updated'`. */
  action: string;
  /** Logical entity type, e.g. `'Participant'`. */
  entity: string;
  entityId?: (c: AuditPointcut) => string | null | undefined;
  /** @default 'snapshot' */
  capture?: CaptureMode;
  /** Runs BEFORE the handler; required for `capture: 'diff'` — ARCHITECTURE.md §4.2. */
  loadBefore?: (c: AuditPointcut) => unknown | Promise<unknown>;
  /** Field paths stripped from this event's `changes`/`metadata`, merged with the global list. */
  redact?: string[];
  metadata?: (c: AuditPointcut) => Record<string, unknown> | undefined;
}

/** Input to the imperative `AuditService.record()` / `.enqueue()` API — README "Imperative +
 * transactional (atomic) API". Deliberately smaller than `AuditEvent`: tenant/actor/occurredAt/
 * hashVersion are filled in from context and config, never passed by hand. */
export interface RecordEventInput {
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
  metadata?: Record<string, unknown>;
}
