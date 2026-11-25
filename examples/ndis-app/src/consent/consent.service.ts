import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@getattestly/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Consent, ConsentMethod, ConsentRelationship } from '../types.js';

export interface GrantConsentInput {
  method: ConsentMethod;
  relationship: ConsentRelationship;
  signatureImage: string;
}

@Injectable()
export class ConsentService {
  readonly repo = new InMemoryRepository<Consent>();

  @Audited({
    action: 'consent.granted',
    entity: 'Consent',
    entityId: (pointcut) => (pointcut.result as Consent).id,
    capture: 'snapshot',
    redact: ['signatureImage'],
    metadata: (pointcut) => {
      const input = pointcut.args[1] as GrantConsentInput;
      return { method: input.method, relationship: input.relationship };
    },
  })
  async grant(participantId: string, input: GrantConsentInput): Promise<Consent> {
    return this.repo.create({
      id: randomUUID(),
      participantId,
      method: input.method,
      relationship: input.relationship,
      signatureImage: input.signatureImage,
      status: 'granted',
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      revokedReason: null,
    });
  }

  @Audited({
    action: 'consent.revoked',
    entity: 'Consent',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'snapshot',
    redact: ['signatureImage'],
    loadBefore: (pointcut) =>
      (pointcut.self as ConsentService).repo.getByIdOrFail(pointcut.args[0] as string),
    metadata: (pointcut) => ({ reason: (pointcut.args[1] as { reason: string }).reason }),
  })
  async revoke(id: string, options: { reason: string }): Promise<Consent> {
    const existing = this.repo.getByIdOrFail(id);
    return this.repo.save({
      ...existing,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedReason: options.reason,
    });
  }

  @Audited({
    action: 'consent.viewed',
    entity: 'Consent',
    entityId: (pointcut) => pointcut.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Consent> {
    return this.repo.getByIdOrFail(id);
  }
}
