import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Participant } from '../types.js';

export type CreateParticipantInput = Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * DOMAIN_CHECKLIST.md §6.3 — the "textbook" shape every entity in this example follows:
 * create → snapshot, update → diff + loadBefore, delete → snapshot + loadBefore, read → none.
 */
@Injectable()
export class ParticipantsService {
  readonly repo = new InMemoryRepository<Participant>();

  @Audited({
    action: 'participant.created',
    entity: 'Participant',
    entityId: (c) => (c.result as Participant).id,
    capture: 'snapshot',
  })
  async create(input: CreateParticipantInput): Promise<Participant> {
    const now = new Date().toISOString();
    return this.repo.create({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  @Audited({
    action: 'participant.updated',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as ParticipantsService).repo.findByIdOrThrow(c.args[0] as string),
  })
  async update(id: string, patch: Partial<CreateParticipantInput>): Promise<Participant> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({ ...existing, ...patch, updatedAt: new Date().toISOString() });
  }

  @Audited({
    action: 'participant.deleted',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'snapshot',
    // The handler returns void — by the time it resolves there's no "after" state left, so the
    // snapshot has to come from loadBefore (what existed right before it was deleted).
    loadBefore: (c) => (c.self as ParticipantsService).repo.findByIdOrThrow(c.args[0] as string),
    metadata: (c) => ({ reason: (c.args[1] as { reason: string }).reason }),
  })
  async delete(id: string, _opts: { reason: string }): Promise<void> {
    this.repo.delete(id);
  }

  @Audited({
    action: 'participant.viewed',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Participant> {
    return this.repo.findByIdOrThrow(id);
  }

  /** Its own action (not `participant.viewed`) with field-count metadata, not a data snapshot —
   * README FAQ: "record.viewed... records access without a payload". */
  @Audited({
    action: 'participant.exported',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'none',
    metadata: (c) => ({ fieldCount: Object.keys(c.result as object).length }),
  })
  async export(id: string): Promise<Participant> {
    return this.repo.findByIdOrThrow(id);
  }
}
