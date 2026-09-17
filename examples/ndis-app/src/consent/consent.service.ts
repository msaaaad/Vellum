import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Audited } from '@vellum/nestjs';
import { InMemoryRepository } from '../in-memory-repository.js';
import type { Consent, ConsentMethod, ConsentRelationship } from '../types.js';

export interface GrantConsentInput {
  method: ConsentMethod;
  relationship: ConsentRelationship;
  signatureImage: string;
}

/** DOMAIN_CHECKLIST.md §6.1 — do this one first: it's the highest-stakes entity. */
@Injectable()
export class ConsentService {
  readonly repo = new InMemoryRepository<Consent>();

  @Audited({
    action: 'consent.granted',
    entity: 'Consent',
    entityId: (c) => (c.result as Consent).id,
    capture: 'snapshot',
    redact: ['signatureImage'],
    metadata: (c) => {
      const input = c.args[1] as GrantConsentInput;
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
    entityId: (c) => c.args[0] as string,
    capture: 'snapshot',
    redact: ['signatureImage'],
    // The pre-revoke record (what was granted, by whom, how) is the evidence worth preserving —
    // more useful here than the post-revoke row, which mostly just says "status: revoked".
    loadBefore: (c) => (c.self as ConsentService).repo.findByIdOrThrow(c.args[0] as string),
    metadata: (c) => ({ reason: (c.args[1] as { reason: string }).reason }),
  })
  async revoke(id: string, opts: { reason: string }): Promise<Consent> {
    const existing = this.repo.findByIdOrThrow(id);
    return this.repo.save({
      ...existing,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedReason: opts.reason,
    });
  }

  @Audited({
    action: 'consent.viewed',
    entity: 'Consent',
    entityId: (c) => c.args[0] as string,
    capture: 'none',
  })
  async view(id: string): Promise<Consent> {
    return this.repo.findByIdOrThrow(id);
  }
}
