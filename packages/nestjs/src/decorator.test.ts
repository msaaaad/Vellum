import { Injectable } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvent, toCanonicalPayload, verifyChain } from '@vellum/core';
import type {
  AuditEvent,
  ChainRow,
  Checkpoint,
  PendingAuditEvent,
  StoragePort,
} from '@vellum/core';
import { AuditWriter } from './audit-writer.service.js';
import { withAuditContext } from './context.js';
import { Audited } from './decorator.js';
import type { AuditModuleOptions } from './types.js';

/** A minimal, real (not mocked) StoragePort — so the event that comes out is genuinely
 * verifiable, not just "the decorator called something". */
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

  async listOutboxTenants() {
    return [];
  }

  async recordCheckpoint(tenantId: string): Promise<Checkpoint> {
    return {
      id: 'c1',
      tenantId,
      headSeq: this.rows.at(-1)?.seq ?? 0,
      headHash: this.rows.at(-1)?.rowHash ?? GENESIS_HASH,
      createdAt: new Date().toISOString(),
      anchoredRef: null,
    };
  }
}

function baseOptions(overrides: Partial<AuditModuleOptions> = {}): AuditModuleOptions {
  return {
    storage: { adapter: 'pg', pool: {} as never },
    tenantResolver: () => 't1',
    actorResolver: () => ({ id: 'u1', type: 'user', label: null }),
    ...overrides,
  };
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

  plainMethod() {
    return 'not audited';
  }
}

const DELETED = { id: 'p1', name: 'Departing Participant' };

@Injectable()
class DeletableParticipantsService {
  @Audited({
    action: 'participant.deleted',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'snapshot',
    loadBefore: (c) => ({ ...DELETED, id: c.args[0] as string }),
    metadata: (c) => ({ reason: (c.args[1] as { reason: string }).reason }),
  })
  async deleteParticipant(_id: string, _opts: { reason: string }): Promise<void> {
    // Deliberately returns nothing — a delete handler commonly does. The snapshot has to come
    // from loadBefore, since by the time this resolves there's no "after" state left to return.
  }
}

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

describe('@Audited() — a real method-wrapping decorator, not a NestInterceptor', () => {
  it('produces exactly one correct, verifiable event for a plain, directly-called service method', async () => {
    const storage = new InMemoryStorage();
    new AuditWriter(storage, baseOptions());
    const service = new ParticipantsService();

    const result = await withAuditContext(ctx, () =>
      service.updateParticipant('p1', {
        name: 'New Name',
        reason: 'participant requested update',
        signatureImage: 'data:image/png;base64,xyz',
      }),
    );

    // The method's own return value passes through untouched.
    expect(result).toEqual({
      id: 'p1',
      name: 'New Name',
      signatureImage: 'data:image/png;base64,xyz',
    });

    // Exactly one event was written, and it verifies as an intact chain — no HTTP request, no
    // controller, no ExecutionContext involved anywhere in this test.
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

    // Request metadata (from the ambient AuditContext) + the decorator's own metadata resolver.
    expect(row.metadata).toEqual({
      ip: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-1',
      route: '/participants/p1',
      reason: 'participant requested update',
    });
  });

  it("capture: 'snapshot' + loadBefore snapshots the pre-mutation record when the method returns nothing (a delete)", async () => {
    const storage = new InMemoryStorage();
    new AuditWriter(storage, baseOptions());
    const service = new DeletableParticipantsService();

    await withAuditContext(ctx, () =>
      service.deleteParticipant('p1', { reason: 'participant withdrew' }),
    );

    expect(storage.rows).toHaveLength(1);
    expect(storage.rows[0]!.changes).toEqual({ after: DELETED });
    expect(storage.rows[0]!.metadata).toMatchObject({ reason: 'participant withdrew' });
  });

  it('leaves an undecorated method completely untouched', async () => {
    const storage = new InMemoryStorage();
    new AuditWriter(storage, baseOptions());
    const service = new ParticipantsService();

    // No withAuditContext at all — if this were somehow intercepted, it would throw.
    expect(service.plainMethod()).toBe('not audited');
    expect(storage.rows).toHaveLength(0);
  });

  it('throws instead of writing when no audit context is present', async () => {
    const storage = new InMemoryStorage();
    new AuditWriter(storage, baseOptions());
    const service = new ParticipantsService();

    await expect(service.updateParticipant('p1', { name: 'New Name' })).rejects.toThrow(
      /no audit context/,
    );
    expect(storage.rows).toHaveLength(0);
  });

  it('propagates a handler error before writing any event', async () => {
    const storage = new InMemoryStorage();
    new AuditWriter(storage, baseOptions());

    @Injectable()
    class FailingService {
      @Audited({ action: 'thing.done', entity: 'Thing', capture: 'none' })
      async doThing(): Promise<never> {
        throw new Error('boom');
      }
    }

    await expect(withAuditContext(ctx, () => new FailingService().doThing())).rejects.toThrow(
      'boom',
    );
    expect(storage.rows).toHaveLength(0);
  });
});
