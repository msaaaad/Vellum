import { Inject, Injectable } from '@nestjs/common';
import { AuditService, withAuditContext } from '@vellum/nestjs';
import type { Participant } from '../types.js';
import type { CreateParticipantInput } from './participants.service.js';
import { ParticipantsService } from './participants.service.js';

/**
 * DOMAIN_CHECKLIST.md §6.6 cross-cutting rules, all three in one place:
 *  - system/cron actions run under `withAuditContext` with `actor.type: 'system'`
 *  - a bulk action produces a summary event PLUS one event per entity, never one opaque row
 *  - imports are audited as `system` with `metadata.source`
 */
@Injectable()
export class ParticipantImportService {
  constructor(
    @Inject(ParticipantsService) private readonly participants: ParticipantsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async importParticipants(
    tenantId: string,
    rows: CreateParticipantInput[],
    source: string,
  ): Promise<Participant[]> {
    return withAuditContext(
      {
        tenantId,
        actor: { id: null, type: 'system', label: `import:${source}` },
        requestMeta: { ip: null, userAgent: null, requestId: null, route: null },
      },
      async () => {
        const created: Participant[] = [];
        for (const row of rows) {
          // Each row still gets its own real participant.created event (system actor, from the
          // ambient context above) — a bulk action is never collapsed into one opaque row.
          created.push(await this.participants.create(row));
        }

        await this.audit.record({
          action: 'participant.import_completed',
          entity: 'ImportBatch',
          metadata: { source, count: created.length },
        });

        return created;
      },
    );
  }
}
