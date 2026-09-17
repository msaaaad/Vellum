import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { renderEvidencePackPdf } from '@vellum/cli/evidence-pack';
import { getPool } from '@/lib/db';
import { buildTenantEvidencePack } from '@/lib/export';

export const dynamic = 'force-dynamic';

/** README "One-click evidence-pack export" — a plain GET so a single link/click downloads the
 * pack; no client-side JS involved. */
export async function GET(_request: Request, { params }: { params: { tenantId: string } }) {
  const pool = getPool();
  const { manifest, events } = await buildTenantEvidencePack(pool, params.tenantId);

  const dir = await mkdtemp(join(tmpdir(), 'vellum-dashboard-export-'));
  const outPath = join(dir, 'evidence-pack.pdf');
  try {
    await renderEvidencePackPdf(outPath, manifest, events);
    const bytes = await readFile(outPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="vellum-evidence-pack-${params.tenantId}.pdf"`,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
