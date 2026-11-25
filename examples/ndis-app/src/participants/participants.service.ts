import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Participant } from '../types.js';

export type CreateParticipantInput = Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class ParticipantsService {
  readonly repo = new InMemoryRepository<Participant>();

  @Audited({
    action: 'participant.created',
    entity: 'Participant',
    entityId: (pointcut) => (pointcut.result as Participant).id,
    capture: 'snapshot',
  })
  async create(input: CreateParticipantInput): Promise<Participant> {
    const now = new Date().toISOString();
    return this.repo.create({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  @Audited({
    action: 'participant.updated',
    entity: 'Participant',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'diff',
    loadBefore: (pointcut) =>
      (pointcut.self as ParticipantsService).repo.getByIdOrFail(pointcut.args[0] as string),
  })
  async update(id: string, patch: Partial<CreateParticipantInput>): Promise<Participant> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({ ...existing, ...patch, updatedAt: new Date().toISOString() });
  }

  @Audited({
    action: 'participant.deleted',
    entity: 'Participant',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'snapshot',
    loadBefore: (pointcut) =>
      (pointcut.self as ParticipantsService).repo.getByIdOrFail(pointcut.args[0] as string),
    metadata: (pointcut) => ({ reason: (pointcut.args[1] as { reason: string }).reason }),
  })
  async delete(id: string, _options: { reason: string }): Promise<void> {
    this.repo.delete(id);
  }

  @Audited({
    action: 'participant.viewed',
    entity: 'Participant',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Participant> {
    return this.repo.getByIdOrFail(id);
  }

  @Audited({
    action: 'participant.exported',
    entity: 'Participant',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'none',
    metadata: (pointcut) => ({ fieldCount: Object.keys(pointcut.result as object).length }),
  })
  async export(id: string): Promise<Participant> {
    return this.repo.getByIdOrFail(id);
  }
}
