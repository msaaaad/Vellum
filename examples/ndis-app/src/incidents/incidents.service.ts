import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@getattestly/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Incident, IncidentSeverity } from '../types.js';

export interface ReportIncidentInput {
  description: string;
  clinicalNotes: string;
  severity: IncidentSeverity;
  reportable: boolean;
}

@Injectable()
export class IncidentsService {
  readonly repo = new InMemoryRepository<Incident>();

  @Audited({
    action: 'incident.reported',
    entity: 'Incident',
    entityId: (pointcut) => (pointcut.result as Incident).id,
    capture: 'snapshot',
    redact: ['clinicalNotes'],
    metadata: (pointcut) => {
      const input = pointcut.args[1] as ReportIncidentInput;
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
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'diff',
    loadBefore: (pointcut) =>
      (pointcut.self as IncidentsService).repo.getByIdOrFail(pointcut.args[0] as string),
    metadata: (pointcut) => ({ reason: pointcut.args[2] as string }),
  })
  async changeSeverity(id: string, severity: IncidentSeverity, _reason: string): Promise<Incident> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({ ...existing, severity });
  }

  @Audited({
    action: 'incident.viewed',
    entity: 'Incident',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Incident> {
    return this.repo.getByIdOrFail(id);
  }

  @Audited({
    action: 'incident.closed',
    entity: 'Incident',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'snapshot',
    metadata: (pointcut) => ({ outcome: pointcut.args[1] as string }),
  })
  async close(id: string, outcome: string): Promise<Incident> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({ ...existing, status: 'closed', outcome });
  }
}
