import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Role } from '../types.js';

@Injectable()
export class RolesService {
  readonly repo = new InMemoryRepository<Role>();

  @Audited({
    action: 'role.assigned',
    entity: 'Role',
    entityId: (pointcut) => (pointcut.result as Role).id,
    capture: 'snapshot',
    metadata: (pointcut) => ({ assignedBy: pointcut.args[2] as string }),
  })
  async assign(workerId: string, roleName: string, _assignedBy: string): Promise<Role> {
    return this.repo.create({
      id: randomUUID(),
      workerId,
      roleName,
      assignedAt: new Date().toISOString(),
      revokedAt: null,
    });
  }

  @Audited({
    action: 'role.revoked',
    entity: 'Role',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'diff',
    loadBefore: (pointcut) =>
      (pointcut.self as RolesService).repo.getByIdOrFail(pointcut.args[0] as string),
    metadata: (pointcut) => ({ assignedBy: pointcut.args[1] as string }),
  })
  async revoke(id: string, _revokedBy: string): Promise<Role> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({ ...existing, revokedAt: new Date().toISOString() });
  }
}
