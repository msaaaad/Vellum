import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { withAuditContext } from './context.js';
import { AUDIT_MODULE_OPTIONS } from './tokens.js';
import type { AuditModuleOptions, AuditRequestMeta } from './types.js';

interface RequestLike {
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  url?: string;
  route?: { path?: string };
}

function header(req: RequestLike, name: string): string | null {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function extractRequestMeta(req: RequestLike): AuditRequestMeta {
  return {
    ip: req.ip ?? req.ips?.[0] ?? req.socket?.remoteAddress ?? null,
    userAgent: header(req, 'user-agent'),
    requestId: header(req, 'x-request-id') ?? randomUUID(),
    route: req.route?.path ?? req.originalUrl ?? req.url ?? null,
  };
}

/**
 * README step 3: `consumer.apply(AuditContextMiddleware).forRoutes('*')`. Runs the configured
 * `tenantResolver`/`actorResolver`, collects request metadata (ip/ua/request-id/route), and
 * stashes it all in `AsyncLocalStorage` for the rest of the request — ARCHITECTURE.md §4.1.
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(@Inject(AUDIT_MODULE_OPTIONS) private readonly options: AuditModuleOptions) {}

  use(req: RequestLike, _res: unknown, next: (err?: unknown) => void): void {
    Promise.resolve()
      .then(async () => {
        const [tenantId, actor] = await Promise.all([
          this.options.tenantResolver(req),
          this.options.actorResolver(req),
        ]);
        const requestMeta = extractRequestMeta(req);
        withAuditContext({ tenantId, actor, requestMeta, request: req }, () => next());
      })
      .catch(next);
  }
}
