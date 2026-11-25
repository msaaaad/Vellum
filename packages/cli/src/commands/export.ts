import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifyChain, type ChainRow } from '@getattestly/core';
import { PgStorageAdapter } from '@getattestly/storage-pg';
import { createPool, resolveDatabaseUrl } from '../db.js';
import { CliError } from '../errors.js';
import { buildManifest } from '../manifest.js';
import { renderEvidencePackPdf } from '../pdf.js';
import { getToolVersion } from '../version.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const START_OF_DAY_TIME = '00:00:00.000';
const END_OF_DAY_TIME = '23:59:59.999';

export function parseDateBoundary(rawDate: string, edge: 'start' | 'end'): string {
  let isoDate = rawDate;
  if (DATE_ONLY.test(rawDate)) {
    const time = edge === 'start' ? START_OF_DAY_TIME : END_OF_DAY_TIME;
    isoDate = `${rawDate}T${time}Z`;
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new CliError(
      `invalid date '${rawDate}' - use ISO 8601, e.g. 2026-01-01 or 2026-01-01T00:00:00Z.`,
    );
  }
  return date.toISOString();
}

export function filterByDate(rows: ChainRow[], from: string | null, to: string | null): ChainRow[] {
  return rows.filter((row) => (!from || row.occurredAt >= from) && (!to || row.occurredAt <= to));
}

function defaultOutPath(tenantId: string, format: 'json' | 'pdf'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `attestly-export-${tenantId}-${stamp}.${format}`;
}

export async function runExport(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
      'database-url': { type: 'string' },
    },
  });

  if (!values.tenant) throw new CliError('--tenant <id> is required.');
  if (values.format !== 'json' && values.format !== 'pdf') {
    throw new CliError("--format must be 'json' or 'pdf'.");
  }

  const from = values.from ? parseDateBoundary(values.from, 'start') : null;
  const to = values.to ? parseDateBoundary(values.to, 'end') : null;

  const pool = createPool(resolveDatabaseUrl(values['database-url']));
  try {
    const adapter = new PgStorageAdapter(pool);
    const allRows = await adapter.readRange(values.tenant);
    const verifyResult = verifyChain(allRows);
    const events = filterByDate(allRows, from, to);

    const manifest = buildManifest({
      tenantId: values.tenant,
      from: values.from ?? null,
      to: values.to ?? null,
      events,
      verify: verifyResult,
      toolVersion: getToolVersion(),
    });

    const outPath = values.out ?? defaultOutPath(values.tenant, values.format);
    if (values.format === 'json') {
      await writeFile(outPath, JSON.stringify({ manifest, events }, null, 2), 'utf8');
    } else {
      await renderEvidencePackPdf(outPath, manifest, events);
    }

    console.log(
      `attestly export: wrote ${outPath} (${events.length} events, ${verifyResult.ok ? 'VERIFIED' : 'FAILED'})`,
    );
    return verifyResult.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}
