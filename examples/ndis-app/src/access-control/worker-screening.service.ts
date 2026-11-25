import { Injectable } from '@nestjs/common';
import { Audited } from '@getattestly/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { WorkerScreening } from '../types.js';

@Injectable()
export class WorkerScreeningService {
  readonly repo = new InMemoryRepository<WorkerScreening>();

  seed(row: WorkerScreening): WorkerScreening {
    return this.repo.create(row);
  }

  @Audited({
    action: 'worker_screening.updated',
    entity: 'WorkerScreening',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'diff',
    loadBefore: (pointcut) =>
      (pointcut.self as WorkerScreeningService).repo.getByIdOrFail(pointcut.args[0] as string),
  })
  async update(
    id: string,
    patch: Partial<Pick<WorkerScreening, 'expiresAt' | 'checkType'>>,
  ): Promise<WorkerScreening> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({ ...existing, ...patch, updatedAt: new Date().toISOString() });
  }
}
