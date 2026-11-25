import type { AuditWriter } from './audit-writer.service.js';

let activeAuditWriter: AuditWriter | undefined;

export function setActiveAuditWriter(writer: AuditWriter): void {
  activeAuditWriter = writer;
}

export function getActiveAuditWriter(): AuditWriter {
  if (!activeAuditWriter) {
    throw new Error(
      'No AuditModule is active - import AuditModule.forRoot()/forRootAsync() in your ' +
        'application before calling an @Audited() method (in a test, resolving any of its ' +
        "providers via the testing module's DI container at least once is enough).",
    );
  }
  return activeAuditWriter;
}
