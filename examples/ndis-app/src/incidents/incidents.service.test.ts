import { describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { withAuditContext } from '@vellum/nestjs';
import { createTestRuntime } from '../test-support.js';
import { IncidentsService } from './incidents.service.js';

const ctx = {
  tenantId: 't1',
  actor: { id: 'u1', type: 'user' as const, label: 'sam@x.io' },
  requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
};

function setup() {
  const { storage } = createTestRuntime();
  return { storage, service: new IncidentsService() };
}

const REPORT_INPUT = {
  description: 'Minor fall during transport',
  clinicalNotes: 'Bruising to left elbow, no fracture.',
  severity: 'medium' as const,
  reportable: true,
};

describe('IncidentsService', () => {
  it('incident.reported redacts clinical notes, keeping severity/reportable as metadata', async () => {
    const { storage, service } = setup();

    await withAuditContext(ctx, () => service.report('p1', REPORT_INPUT));

    const row = storage.rows[0]!;
    expect(row.action).toBe('incident.reported');
    expect(row.changes).not.toHaveProperty('after.clinicalNotes');
    expect(row.changes).toMatchObject({ after: { description: REPORT_INPUT.description } });
    expect(row.metadata).toMatchObject({ severity: 'medium', reportable: true });
  });

  it('incident.severity_changed is a diff, with the reason as metadata', async () => {
    const { storage, service } = setup();

    const incident = await withAuditContext(ctx, () => service.report('p1', REPORT_INPUT));
    await withAuditContext(ctx, () =>
      service.changeSeverity(incident.id, 'high', 'clinical review escalated severity'),
    );

    const row = storage.rows[1]!;
    expect(row.action).toBe('incident.severity_changed');
    expect(row.changes).toMatchObject({ diff: { severity: ['medium', 'high'] } });
    expect(row.metadata).toMatchObject({ reason: 'clinical review escalated severity' });
  });

  it('incident.viewed records who looked, with no payload', async () => {
    const { storage, service } = setup();

    const incident = await withAuditContext(ctx, () => service.report('p1', REPORT_INPUT));
    await withAuditContext(ctx, () => service.view(incident.id));

    expect(storage.rows[1]!.action).toBe('incident.viewed');
    expect(storage.rows[1]!.changes).toEqual({});
  });

  it('incident.closed snapshots the closed record with the outcome as metadata', async () => {
    const { storage, service } = setup();

    const incident = await withAuditContext(ctx, () => service.report('p1', REPORT_INPUT));
    await withAuditContext(ctx, () => service.close(incident.id, 'resolved, no lasting injury'));

    const row = storage.rows[1]!;
    expect(row.action).toBe('incident.closed');
    expect(row.changes).toMatchObject({ after: { status: 'closed' } });
    expect(row.metadata).toMatchObject({ outcome: 'resolved, no lasting injury' });
  });

  it('report -> view -> escalate -> close reads as one verifiable timeline', async () => {
    const { storage, service } = setup();

    await withAuditContext(ctx, async () => {
      const incident = await service.report('p1', REPORT_INPUT);
      await service.view(incident.id);
      await service.changeSeverity(incident.id, 'high', 'escalated');
      await service.close(incident.id, 'resolved');
    });

    expect(storage.rows.map((r) => r.action)).toEqual([
      'incident.reported',
      'incident.viewed',
      'incident.severity_changed',
      'incident.closed',
    ]);
    expect(verifyChain(storage.rows)).toMatchObject({ ok: true, count: 4 });
  });
});
