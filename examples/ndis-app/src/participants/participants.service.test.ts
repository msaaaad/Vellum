import { describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { ParticipantsService } from './participants.service.js';

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

function setup() {
  const { storage } = createTestRuntime();
  return { storage, service: new ParticipantsService() };
}

describe('ParticipantsService', () => {
  it('participant.created is a full snapshot', async () => {
    const { storage, service } = setup();

    const participant = await withAuditContext(ctx, () =>
      service.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      }),
    );

    expect(storage.rows).toHaveLength(1);
    const row = storage.rows[0]!;
    expect(row.action).toBe('participant.created');
    expect(row.entity).toEqual({ type: 'Participant', id: participant.id });
    expect(row.changes).toEqual({ after: participant });
  });

  it('participant.updated is a diff against the pre-update record', async () => {
    const { storage, service } = setup();

    const participant = await withAuditContext(ctx, () =>
      service.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      }),
    );
    await withAuditContext(ctx, () =>
      service.update(participant.id, { fullName: 'Jordan A. Lee' }),
    );

    const row = storage.rows[1]!;
    expect(row.action).toBe('participant.updated');
    expect(row.changes).toMatchObject({
      diff: { fullName: ['Jordan Lee', 'Jordan A. Lee'] },
    });
  });

  it('participant.deleted snapshots the pre-delete record even though delete() returns void', async () => {
    const { storage, service } = setup();

    const participant = await withAuditContext(ctx, () =>
      service.create({
        fullName: 'Temp',
        dateOfBirth: '2000-01-01',
        ndisNumber: '000000000',
        primaryDisability: 'n/a',
      }),
    );
    await withAuditContext(ctx, () =>
      service.delete(participant.id, { reason: 'duplicate record' }),
    );

    const row = storage.rows[1]!;
    expect(row.action).toBe('participant.deleted');
    expect(row.changes).toEqual({ after: participant });
    expect(row.metadata).toMatchObject({ reason: 'duplicate record' });
  });

  it('participant.viewed carries no payload', async () => {
    const { storage, service } = setup();

    const participant = await withAuditContext(ctx, () =>
      service.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      }),
    );
    await withAuditContext(ctx, () => service.view(participant.id));

    const row = storage.rows[1]!;
    expect(row.action).toBe('participant.viewed');
    expect(row.changes).toEqual({});
  });

  it('participant.exported carries field-count metadata, not the data itself', async () => {
    const { storage, service } = setup();

    const participant = await withAuditContext(ctx, () =>
      service.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      }),
    );
    await withAuditContext(ctx, () => service.export(participant.id));

    const row = storage.rows[1]!;
    expect(row.action).toBe('participant.exported');
    expect(row.changes).toEqual({});
    expect(row.metadata).toMatchObject({ fieldCount: Object.keys(participant).length });
  });

  it('the full create/update/view/export/delete story chains into one verifiable timeline', async () => {
    const { storage, service } = setup();

    await withAuditContext(ctx, async () => {
      const participant = await service.create({
        fullName: 'Jordan Lee',
        dateOfBirth: '1994-03-02',
        ndisNumber: '430123456',
        primaryDisability: 'Autism',
      });
      await service.update(participant.id, { fullName: 'Jordan A. Lee' });
      await service.view(participant.id);
      await service.export(participant.id);
      await service.delete(participant.id, { reason: 'duplicate record' });
    });

    expect(storage.rows.map((r) => r.action)).toEqual([
      'participant.created',
      'participant.updated',
      'participant.viewed',
      'participant.exported',
      'participant.deleted',
    ]);
    expect(verifyChain(storage.rows)).toMatchObject({ ok: true, count: 5 });
  });
});
