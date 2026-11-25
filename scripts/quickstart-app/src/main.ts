import 'reflect-metadata';
import { Controller, Injectable, Module, Post, Body, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { Audited, AuditContextMiddleware, AuditModule } from '@vellum/nestjs';

// This file follows the README quick start step by step.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

@Injectable()
class ParticipantsRepo {
  private rows = new Map<string, { id: string; name: string }>([['p-1', { id: 'p-1', name: 'Jordan' }]]);
  findById(id: string) {
    return this.rows.get(id);
  }
  update(id: string, patch: { name: string }) {
    const next = { id, ...patch };
    this.rows.set(id, next);
    return next;
  }
}

@Injectable()
class ParticipantsService {
  constructor(readonly repo: ParticipantsRepo) {}

  // Step 4 of the README: one decorator.
  @Audited({
    action: 'participant.updated',
    entity: 'Participant',
    entityId: (c) => c.args[0] as string,
    capture: 'diff',
    loadBefore: (c) => (c.self as ParticipantsService).repo.findById(c.args[0] as string),
  })
  async updateParticipant(id: string, patch: { name: string }) {
    return this.repo.update(id, patch);
  }
}

@Controller('participants')
class ParticipantsController {
  constructor(private readonly service: ParticipantsService) {}

  @Post()
  update(@Body() body: { id: string; name: string }) {
    return this.service.updateParticipant(body.id, { name: body.name });
  }
}

@Module({
  imports: [
    // Step 2 of the README.
    AuditModule.forRoot({
      storage: { adapter: 'pg', pool },
      mode: 'inline',
      tenantResolver: (req) => (req as { headers: Record<string, string> }).headers['x-tenant-id']!,
      actorResolver: () => ({ id: 'user-1', type: 'user', label: 'sam@example.com' }),
    }),
  ],
  controllers: [ParticipantsController],
  providers: [ParticipantsRepo, ParticipantsService],
})
class AppModule implements NestModule {
  // Step 3 of the README.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const url = await app.getUrl();
  const tenant = process.env.TENANT_ID!;

  for (const name of ['Jordan L.', 'Jordan Lee']) {
    const res = await fetch(`${url}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenant },
      body: JSON.stringify({ id: 'p-1', name }),
    });
    if (!res.ok) throw new Error(`request failed: ${res.status} ${await res.text()}`);
  }

  const rows = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1", [tenant]);
  console.log(`audit events written: ${rows.rows[0].n}`);
  await app.close();
  await pool.end();
  if (rows.rows[0].n !== 2) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
