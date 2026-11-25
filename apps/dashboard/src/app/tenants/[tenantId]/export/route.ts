import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { renderEvidencePackPdf } from '@attestly/cli/evidence-pack';
import { getPool } from '@/lib/db';
import { buildTenantEvidencePack } from '@/lib/export';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { tenantId: string } }) {
  const pool = getPool();
  const { manifest, events } = await buildTenantEvidencePack(pool, params.tenantId);

  const exportDirectory = await mkdtemp(join(tmpdir(), 'attestly-dashboard-export-'));
  const outPath = join(exportDirectory, 'evidence-pack.pdf');
  try {
    await renderEvidencePackPdf(outPath, manifest, events);
    const pdfBytes = await readFile(outPath);
    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="attestly-evidence-pack-${params.tenantId}.pdf"`,
      },
    });
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
}
