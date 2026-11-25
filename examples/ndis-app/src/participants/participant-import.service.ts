import { Inject, Injectable } from '@nestjs/common';
import { AuditService, withAuditContext } from '@getattestly/nestjs';
import type { Participant } from '../types.js';
import type { CreateParticipantInput } from './participants.service.js';
import { ParticipantsService } from './participants.service.js';

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
