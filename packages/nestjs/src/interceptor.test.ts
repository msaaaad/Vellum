import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { from, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvent, toCanonicalPayload, verifyChain } from '@vellum/core';
import type { AuditEvent, ChainRow, PendingAuditEvent, StoragePort } from '@vellum/core';
import { AuditWriter } from './audit-writer.service.js';
import { Audited } from './decorator.js';
import { withAuditContext } from './context.js';
import { AuditInterceptor } from './interceptor.js';
import { AUDIT_MODULE_OPTIONS, AUDIT_STORAGE } from './tokens.js';
import type { AuditModuleOptions } from './types.js';

/** A minimal, real (not mocked) StoragePort — so the event that comes out is genuinely
 * verifiable, not just "the interceptor called something". */
class InMemoryStorage implements StoragePort<unknown> {
  rows: ChainRow[] = [];

  async head() {
    const last = this.rows.at(-1);
    return last ? { seq: last.seq, rowHash: last.rowHash } : null;
  }

  async appendInline(event: PendingAuditEvent): Promise<ChainRow> {
    const last = this.rows.at(-1);
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.rowHash : GENESIS_HASH;
    const full: AuditEvent = { ...event, seq };
    const rowHash = hashEvent(prevHash, toCanonicalPayload(full));
    const row: ChainRow = { ...full, prevHash, rowHash };
    this.rows.push(row);
    return row;
  }

  async readRange() {
    return this.rows;
  }

  async enqueue(): Promise<void> {
    throw new Error('not used in this test');
  }

  async drainOutbox() {
    return [];
  }
}

const OLD_NAME = 'Old Name';

// `this` inside a decorator-factory argument is evaluated at class-definition time (before any
// instance exists), so resolvers close over module-level state / their own args, not `this`.
@Injectable()
class ParticipantsService {
  @Audited({
    action: 'participant.updated',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    redact: ['signatureImage'],
    loadBefore: (c) => ({ id: c.args[0] as string, name: OLD_NAME }),
    metadata: (c) => ({ reason: (c.args[1] as { reason?: string }).reason }),
  })
  async updateParticipant(
    id: string,
    patch: { name?: string; reason?: string; signatureImage?: string },
  ) {
    return { id, name: patch.name ?? OLD_NAME, signatureImage: patch.signatureImage };
  }
}

function fakeContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept any method's signature
  handler: (...args: any[]) => unknown,
  cls: new (...args: unknown[]) => unknown,
  args: unknown[],
) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    getArgs: () => args,
    switchToHttp: () => ({
      getRequest: () => undefined,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor + @Audited', () => {
  it('produces exactly one correct, verifiable event for a decorated method', async () => {
    const storage = new InMemoryStorage();
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: {} as never },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: 'sam@x.io' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipantsService,
        AuditInterceptor,
        AuditWriter,
        Reflector,
        { provide: AUDIT_STORAGE, useValue: storage },
        { provide: AUDIT_MODULE_OPTIONS, useValue: options },
      ],
    }).compile();

    const interceptor = moduleRef.get(AuditInterceptor);
    const service = moduleRef.get(ParticipantsService);

    const args: [string, { name: string; reason: string; signatureImage: string }] = [
      'p1',
      {
        name: 'New Name',
        reason: 'participant requested update',
        signatureImage: 'data:image/png;base64,xyz',
      },
    ];
    const context = fakeContext(service.updateParticipant, ParticipantsService, args);
    const handler: CallHandler = { handle: () => from(service.updateParticipant(...args)) };

    const ctx = {
      tenantId: 't1',
      actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
      requestMeta: {
        ip: '127.0.0.1',
        userAgent: 'vitest',
        requestId: 'req-1',
        route: '/participants/p1',
      },
    };

    const result = await withAuditContext(ctx, () =>
      lastValueFrom(interceptor.intercept(context, handler)),
    );

    // The handler's return value passes through untouched.
    expect(result).toEqual({
      id: 'p1',
      name: 'New Name',
      signatureImage: 'data:image/png;base64,xyz',
    });

    // Exactly one event was written, and it verifies as an intact chain.
    expect(storage.rows).toHaveLength(1);
    expect(verifyChain(storage.rows)).toMatchObject({ ok: true, count: 1 });

    const row = storage.rows[0]!;
    expect(row.action).toBe('participant.updated');
    expect(row.entity).toEqual({ type: 'Participant', id: 'p1' });
    expect(row.tenantId).toBe('t1');
    expect(row.actor).toEqual({ id: 'u1', type: 'user', label: 'sam@x.io' });

    // Diff capture: before/after/diff, with the redacted field stripped from all three places
    // it could leak (before, after, and the diff itself).
    expect(row.changes).toEqual({
      before: { id: 'p1', name: 'Old Name' },
      after: { id: 'p1', name: 'New Name' },
      diff: { name: ['Old Name', 'New Name'] },
    });

    // Request metadata + the decorator's own metadata resolver both land in `metadata`.
    expect(row.metadata).toEqual({
      ip: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-1',
      route: '/participants/p1',
      reason: 'participant requested update',
    });
  });

  it('passes non-audited methods straight through with no write', async () => {
    const storage = new InMemoryStorage();
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: {} as never },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        AuditWriter,
        Reflector,
        { provide: AUDIT_STORAGE, useValue: storage },
        { provide: AUDIT_MODULE_OPTIONS, useValue: options },
      ],
    }).compile();

    const interceptor = moduleRef.get(AuditInterceptor);
    const plainHandler = () => 'unaudited result';
    const context = fakeContext(plainHandler, class Plain {}, []);
    const handler: CallHandler = { handle: () => from(Promise.resolve('unaudited result')) };

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toBe('unaudited result');
    expect(storage.rows).toHaveLength(0);
  });

  it('throws instead of writing when no audit context is present', async () => {
    const storage = new InMemoryStorage();
    const options: AuditModuleOptions = {
      storage: { adapter: 'pg', pool: {} as never },
      tenantResolver: () => 't1',
      actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipantsService,
        AuditInterceptor,
        AuditWriter,
        Reflector,
        { provide: AUDIT_STORAGE, useValue: storage },
        { provide: AUDIT_MODULE_OPTIONS, useValue: options },
      ],
    }).compile();

    const interceptor = moduleRef.get(AuditInterceptor);
    const service = moduleRef.get(ParticipantsService);
    const args: [string, { name: string }] = ['p1', { name: 'New Name' }];
    const context = fakeContext(service.updateParticipant, ParticipantsService, args);
    const handler: CallHandler = { handle: () => from(service.updateParticipant(...args)) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow(
      /no audit context/,
    );
    expect(storage.rows).toHaveLength(0);
  });
});
