import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Role } from '../types.js';

/** DOMAIN_CHECKLIST.md §6.5 — access control. */
@Injectable()
export class RolesService {
  readonly repo = new InMemoryRepository<Role>();

  // A fresh assignment is a create, not a state change — matches the general
  // "create → snapshot" pattern (the checklist's shared "diff + loadBefore" bullet line for
  // role.assigned/role.revoked reads most sensibly as describing revoke's shape; assigning a
  // role that didn't exist a moment ago has no meaningful "before" to diff against).
  @Audited({
    action: 'role.assigned',
    entity: 'Role',
    entityId: (c) => (c.result as Role).id,
    capture: 'snapshot',
    metadata: (c) => ({ assignedBy: c.args[2] as string }),
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
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as RolesService).repo.findByIdOrThrow(c.args[0] as string),
    metadata: (c) => ({ assignedBy: c.args[1] as string }),
  })
  async revoke(id: string, _revokedBy: string): Promise<Role> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({ ...existing, revokedAt: new Date().toISOString() });
  }
}
