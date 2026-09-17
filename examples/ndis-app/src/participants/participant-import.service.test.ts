import { describe, expect, it } from 'vitest';
import { verifyChain } from '@vellum/core';
import { createTestRuntime } from '../test-support.js';
import { ParticipantImportService } from './participant-import.service.js';
import { ParticipantsService } from './participants.service.js';

describe('ParticipantImportService — DOMAIN_CHECKLIST.md §6.6 cross-cutting rules', () => {
  it('runs as a system actor, writes a summary event + one per-row event, and needs no ambient context of its own', async () => {
    const { storage, audit } = createTestRuntime();
    const participants = new ParticipantsService();
    const service = new ParticipantImportService(participants, audit);

    // Deliberately NOT wrapped in withAuditContext by the caller — the import service establishes
    // its own system-actor context internally.
    const created = await service.importParticipants(
      't1',
      [
        {
          fullName: 'Import One',
          dateOfBirth: '1990-01-01',
          ndisNumber: '111111111',
          primaryDisability: 'n/a',
        },
        {
          fullName: 'Import Two',
          dateOfBirth: '1991-02-02',
          ndisNumber: '222222222',
          primaryDisability: 'n/a',
        },
      ],
      'legacy-provider-csv',
    );

    expect(created).toHaveLength(2);

    // One participant.created per row, never one opaque row for the whole batch.
    const createdEvents = storage.rows.filter((r) => r.action === 'participant.created');
    expect(createdEvents).toHaveLength(2);
    for (const row of createdEvents) {
      expect(row.actor).toEqual({ id: null, type: 'system', label: 'import:legacy-provider-csv' });
      expect(row.tenantId).toBe('t1');
    }

    // Plus one summary event for the whole batch.
    const summary = storage.rows.find((r) => r.action === 'participant.import_completed');
    expect(summary).toBeDefined();
    expect(summary!.actor.type).toBe('system');
    expect(summary!.metadata).toMatchObject({ source: 'legacy-provider-csv', count: 2 });

    expect(storage.rows).toHaveLength(3);
    expect(verifyChain(storage.rows)).toMatchObject({ ok: true, count: 3 });
  });
});
