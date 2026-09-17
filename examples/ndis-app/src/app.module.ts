import { Module } from '@nestjs/common';
import type { AuditActor } from '@vellum/core';
import { AuditModule } from '@vellum/nestjs';
import { AuthService } from './access-control/auth.service.js';
import { RolesService } from './access-control/roles.service.js';
import { WorkerScreeningService } from './access-control/worker-screening.service.js';
import { ClaimsService } from './agreements/claims.service.js';
import { ServiceAgreementsService } from './agreements/service-agreements.service.js';
import { ConsentService } from './consent/consent.service.js';
import { createPool, EXAMPLE_PG_POOL } from './db.js';
import { IncidentsService } from './incidents/incidents.service.js';
import { ParticipantImportService } from './participants/participant-import.service.js';
import { ParticipantsService } from './participants/participants.service.js';

const pool = createPool();

/**
 * This example never runs an HTTP server — every audited call happens inside a manually
 * established `withAuditContext()` block (`seed.ts`), the non-HTTP path ARCHITECTURE.md §4.1
 * describes for jobs/CLI/seeds. `tenantResolver`/`actorResolver` exist only because
 * `AuditModuleOptions` requires them; a `AuditContextMiddleware` that would call them is never
 * wired up, so they're never actually invoked.
 */
function unusedResolver(kind: 'tenant' | 'actor'): () => never {
  return () => {
    throw new Error(
      `${kind}Resolver was called — this example has no HTTP layer; every call should already be wrapped in withAuditContext() (see seed.ts).`,
    );
  };
}

@Module({
  imports: [
    AuditModule.forRoot({
      storage: { adapter: 'pg', pool },
      mode: 'inline',
      tenantResolver: unusedResolver('tenant'),
      actorResolver: unusedResolver('actor') as () => AuditActor,
    }),
  ],
  providers: [
    { provide: EXAMPLE_PG_POOL, useValue: pool },
    ParticipantsService,
    ParticipantImportService,
    ConsentService,
    IncidentsService,
    ServiceAgreementsService,
    ClaimsService,
    RolesService,
    AuthService,
    WorkerScreeningService,
  ],
  exports: [
    ParticipantsService,
    ParticipantImportService,
    ConsentService,
    IncidentsService,
    ServiceAgreementsService,
    ClaimsService,
    RolesService,
    AuthService,
    WorkerScreeningService,
  ],
})
export class AppModule {}
