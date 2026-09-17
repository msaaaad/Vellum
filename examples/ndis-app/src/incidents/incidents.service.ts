import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Incident, IncidentSeverity } from '../types.js';

export interface ReportIncidentInput {
  description: string;
  clinicalNotes: string;
  severity: IncidentSeverity;
  reportable: boolean;
}

/** DOMAIN_CHECKLIST.md §6.2 — the second entity, right after Consent. */
@Injectable()
export class IncidentsService {
  readonly repo = new InMemoryRepository<Incident>();

  @Audited({
    action: 'incident.reported',
    entity: 'Incident',
    entityId: (c) => (c.result as Incident).id,
    capture: 'snapshot',
    redact: ['clinicalNotes'],
    metadata: (c) => {
      const input = c.args[1] as ReportIncidentInput;
      return { severity: input.severity, reportable: input.reportable };
    },
  })
  async report(participantId: string, input: ReportIncidentInput): Promise<Incident> {
    return this.repo.create({
      id: randomUUID(),
      participantId,
      description: input.description,
      clinicalNotes: input.clinicalNotes,
      severity: input.severity,
      reportable: input.reportable,
      status: 'open',
      outcome: null,
      createdAt: new Date().toISOString(),
    });
  }

  @Audited({
    action: 'incident.severity_changed',
    entity: 'Incident',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as IncidentsService).repo.findByIdOrThrow(c.args[0] as string),
    metadata: (c) => ({ reason: c.args[2] as string }),
  })
  async changeSeverity(id: string, severity: IncidentSeverity, _reason: string): Promise<Incident> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({ ...existing, severity });
  }

  /** Who looked during the investigation matters for a high-stakes entity like this one, so
   * reads are audited too — capture: 'none' still records the access itself. */
  @Audited({
    action: 'incident.viewed',
    entity: 'Incident',
    entityId: (c) => c.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Incident> {
    return this.repo.findByIdOrThrow(id);
  }

  @Audited({
    action: 'incident.closed',
    entity: 'Incident',
    entityId: (c) => c.args[0] as string,
    capture: 'snapshot',
    metadata: (c) => ({ outcome: c.args[1] as string }),
  })
  async close(id: string, outcome: string): Promise<Incident> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({ ...existing, status: 'closed', outcome });
  }
}
