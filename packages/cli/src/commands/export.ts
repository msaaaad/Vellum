import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifyChain, type ChainRow } from '@vellum/core';
import { PgStorageAdapter } from '@vellum/storage-pg';
import { createPool, resolveDatabaseUrl } from '../db.js';
import { CliError } from '../errors.js';
import { buildManifest } from '../manifest.js';
import { renderEvidencePackPdf } from '../pdf.js';
import { getToolVersion } from '../version.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Bare `YYYY-MM-DD` is inclusive of the whole day — the intuitive reading of `--to 2026-06-30`. */
export function parseDateBoundary(raw: string, edge: 'start' | 'end'): string {
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : raw;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new CliError(
      `invalid date '${raw}' — use ISO 8601, e.g. 2026-01-01 or 2026-01-01T00:00:00Z.`,
    );
  }
  return date.toISOString();
}

export function filterByDate(rows: ChainRow[], from: string | null, to: string | null): ChainRow[] {
  return rows.filter((row) => (!from || row.occurredAt >= from) && (!to || row.occurredAt <= to));
}

function defaultOutPath(tenantId: string, format: 'json' | 'pdf'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `vellum-export-${tenantId}-${stamp}.${format}`;
}

/**
 * `vellum export --tenant <id> [--from --to] --format json|pdf [--out <path>]` — README
 * "Evidence packs". Always runs a **full-chain** verify first (ARCHITECTURE.md §6), regardless
 * of `--from`/`--to`, and stamps that result on the pack — a broken chain still produces a
 * pack, just one whose cover says FAILED, so a tamper attempt is evidence, not a dead end.
 */
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
    const verify = verifyChain(allRows);
    const events = filterByDate(allRows, from, to);

    const manifest = buildManifest({
      tenantId: values.tenant,
      from: values.from ?? null,
      to: values.to ?? null,
      events,
      verify,
      toolVersion: getToolVersion(),
    });

    const outPath = values.out ?? defaultOutPath(values.tenant, values.format);
    if (values.format === 'json') {
      await writeFile(outPath, JSON.stringify({ manifest, events }, null, 2), 'utf8');
    } else {
      await renderEvidencePackPdf(outPath, manifest, events);
    }

    console.log(
      `vellum export: wrote ${outPath} (${events.length} events, ${verify.ok ? 'VERIFIED' : 'FAILED'})`,
    );
    return verify.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}
