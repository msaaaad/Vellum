import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import type { AuditActor } from '@vellum/core';
import { withAuditContext } from '@vellum/nestjs';
import { AuthService } from './access-control/auth.service.js';
import { RolesService } from './access-control/roles.service.js';
import { WorkerScreeningService } from './access-control/worker-screening.service.js';
import { ClaimsService } from './agreements/claims.service.js';
import { ServiceAgreementsService } from './agreements/service-agreements.service.js';
import { ConsentService } from './consent/consent.service.js';
import { IncidentsService } from './incidents/incidents.service.js';
import { ParticipantImportService } from './participants/participant-import.service.js';
import { ParticipantsService } from './participants/participants.service.js';

/**
 * DOMAIN_CHECKLIST.md Phase 6 done-when: "a seeded participant's full story (create → consent →
 * agreement → claim → incident) exports as one ordered, verified timeline." Runs exactly that
 * story for one tenant, plus enough of the rest of the checklist's entities/actions to exercise
 * every capture mode this example demonstrates. Shared between `seed.ts` (the runnable CLI
 * script) and `ndis-app.integration.test.ts` (which runs this same story against a real
 * Postgres database and checks the result), so there's one definition of "the story", not two
 * that can drift apart.
 */
export async function runFullStory(app: INestApplicationContext, tenantId: string): Promise<void> {
  const participants = app.get(ParticipantsService);
  const imports = app.get(ParticipantImportService);
  const consent = app.get(ConsentService);
  const incidents = app.get(IncidentsService);
  const agreements = app.get(ServiceAgreementsService);
  const claims = app.get(ClaimsService);
  const roles = app.get(RolesService);
  const auth = app.get(AuthService);
  const screenings = app.get(WorkerScreeningService);

  const actor: AuditActor = { id: 'worker-1', type: 'user', label: 'sam@example-provider.org.au' };
  const requestMeta = { ip: null, userAgent: null, requestId: null, route: null };

  await withAuditContext({ tenantId, actor, requestMeta }, async () => {
    // --- The core story: create -> consent -> agreement -> claim -> incident ---
    const participant = await participants.create({
      fullName: 'Jordan Lee',
      dateOfBirth: '1994-03-02',
      ndisNumber: '430123456',
      primaryDisability: 'Autism',
    });

    const grantedConsent = await consent.grant(participant.id, {
      method: 'written',
      relationship: 'self',
      signatureImage: 'data:image/png;base64,AAAA',
    });

    const agreement = await agreements.create(participant.id, '2026-01-01–2026-12-31');

    const claim = await claims.create(agreement.id, participant.id, {
      ndisPeriod: '2026-01',
      amountCents: 15_000,
      bankAccount: '123-456 00998877',
    });
    await claims.submit(claim.id);
    await claims.approve(claim.id);
    await claims.pay(claim.id);

    const incident = await incidents.report(participant.id, {
      description: 'Minor fall during transport',
      clinicalNotes: 'Bruising to left elbow, no fracture observed.',
      severity: 'medium',
      reportable: true,
    });

    // --- The rest of the checklist: every other capture mode/action this example wires up ---
    await participants.view(participant.id);
    await participants.export(participant.id);

    await consent.view(grantedConsent.id);
    await consent.revoke(grantedConsent.id, { reason: 'participant withdrew consent' });

    await incidents.view(incident.id);
    await incidents.changeSeverity(incident.id, 'high', 'clinical review escalated severity');
    await incidents.close(incident.id, 'resolved, no lasting injury; transport procedure updated');

    await agreements.update(agreement.id, { status: 'active' });

    const role = await roles.assign('worker-1', 'support-coordinator', 'admin-1');
    await roles.revoke(role.id, 'admin-1');

    const screening = screenings.seed({
      id: randomUUID(),
      workerId: 'worker-1',
      checkType: 'NDIS Worker Screening',
      expiresAt: '2026-12-31',
      updatedAt: new Date().toISOString(),
    });
    await screenings.update(screening.id, { expiresAt: '2027-06-30' });

    await auth.login('worker-1', 'correct-horse-battery-staple').catch(() => undefined);
    await auth.login('worker-1', 'wrong-password').catch(() => undefined);

    const toDelete = await participants.create({
      fullName: 'Temporary Duplicate',
      dateOfBirth: '2000-01-01',
      ndisNumber: '000000000',
      primaryDisability: 'n/a',
    });
    await participants.delete(toDelete.id, { reason: 'duplicate record' });
  });

  // Runs its OWN withAuditContext internally, as a system actor — not nested in the block above.
  await imports.importParticipants(
    tenantId,
    [
      {
        fullName: 'Import One',
        dateOfBirth: '1990-01-01',
        ndisNumber: '111111111',
        primaryDisability: 'n/a',
      },
      {
        fullName: 'Import Two',
        dateOfBirth: '1991-02-02',
        ndisNumber: '222222222',
        primaryDisability: 'n/a',
      },
    ],
    'legacy-provider-csv',
  );
}
