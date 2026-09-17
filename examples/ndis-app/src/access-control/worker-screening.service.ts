import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { WorkerScreening } from '../types.js';

/** DOMAIN_CHECKLIST.md §6.5 — "expiry changes matter for compliance", hence `diff`. */
@Injectable()
export class WorkerScreeningService {
  readonly repo = new InMemoryRepository<WorkerScreening>();

  /** Not itself an audited action — seeding the initial screening record a worker already has
   * on file, so `update()` below has something to diff against. */
  seed(row: WorkerScreening): WorkerScreening {
    return this.repo.create(row);
  }

  @Audited({
    action: 'worker_screening.updated',
    entity: 'WorkerScreening',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as WorkerScreeningService).repo.findByIdOrThrow(c.args[0] as string),
  })
  async update(
    id: string,
    patch: Partial<Pick<WorkerScreening, 'expiresAt' | 'checkType'>>,
  ): Promise<WorkerScreening> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({ ...existing, ...patch, updatedAt: new Date().toISOString() });
  }
}
