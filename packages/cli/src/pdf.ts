import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import type { ChainRow } from '@vellum/core';
import type { ExportManifest } from './manifest.js';

const VERIFIED_COLOR = '#0a7d2c';
const FAILED_COLOR = '#b00020';

interface Column {
  label: string;
  x: number;
  width: number;
  value: (row: ChainRow) => string;
}

const COLUMNS: Column[] = [
  { label: 'Seq', x: 50, width: 35, value: (r) => String(r.seq) },
  { label: 'Occurred at', x: 85, width: 130, value: (r) => r.occurredAt },
  { label: 'Actor', x: 215, width: 110, value: (r) => r.actor.label ?? r.actor.id ?? r.actor.type },
  { label: 'Action', x: 325, width: 130, value: (r) => r.action },
  {
    label: 'Entity',
    x: 455,
    width: 95,
    value: (r) => (r.entity.id ? `${r.entity.type}:${r.entity.id}` : r.entity.type),
  },
];

const ROW_HEIGHT = 16;
const TABLE_TOP = 90;

export interface CoverStamp {
  label: 'VERIFIED' | 'FAILED';
  color: string;
  verifyLine: string;
}

/**
 * The pure decision behind the cover page — kept separate from any pdfkit calls so it's
 * directly unit-testable without generating (or parsing) an actual PDF. `renderEvidencePackPdf`
 * below just draws whatever this returns.
 */
export function coverStampFor(manifest: ExportManifest): CoverStamp {
  if (manifest.verify.ok) {
    return { label: 'VERIFIED', color: VERIFIED_COLOR, verifyLine: 'INTACT' };
  }
  return {
    label: 'FAILED',
    color: FAILED_COLOR,
    verifyLine: `TAMPERED at seq ${manifest.verify.brokenAt} (${manifest.verify.brokenReason})`,
  };
}

/**
 * README "Evidence packs" — a cover page (VERIFIED/FAILED stamp + manifest fields) followed by
 * a readable event table. Resolves once the file is fully flushed to disk.
 */
export function renderEvidencePackPdf(
  outPath: string,
  manifest: ExportManifest,
  events: ChainRow[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = createWriteStream(outPath);
    stream.on('error', reject);
    // 'close' (fd actually closed), not 'finish' (buffers merely handed off) — a reader that
    // opens the file right after 'finish' can otherwise see a not-yet-fully-durable file.
    stream.on('close', resolve);
    doc.pipe(stream);

    drawCoverPage(doc, manifest);
    doc.addPage();
    drawEventTable(doc, events);

    doc.end();
  });
}

function drawCoverPage(doc: PDFKit.PDFDocument, manifest: ExportManifest): void {
  const stamp = coverStampFor(manifest);

  doc
    .font('Helvetica-Bold')
    .fontSize(36)
    .fillColor(stamp.color)
    .text(stamp.label, { align: 'center' });

  doc.moveDown(0.5);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#000000')
    .text('Vellum Evidence Pack', { align: 'center' });
  doc.moveDown(2);

  const fields: Array<[string, string]> = [
    ['Tenant', manifest.tenantId],
    ['Range', `${manifest.range.from ?? '(full history)'} … ${manifest.range.to ?? 'now'}`],
    ['Event count', String(manifest.count)],
    ['Chain head', manifest.headHash ?? '(unavailable — chain broken)'],
    ['Tool version', manifest.toolVersion],
    ['Generated at', manifest.generatedAt],
    ['Verify result', stamp.verifyLine],
  ];

  doc.fontSize(11);
  for (const [label, value] of fields) {
    doc
      .font('Helvetica-Bold')
      .text(`${label}:  `, { continued: true })
      .font('Helvetica')
      .text(value);
    doc.moveDown(0.3);
  }
}

function drawEventTable(doc: PDFKit.PDFDocument, events: ChainRow[]): void {
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('Events', 50, 50);

  let y = drawTableHeader(doc);
  for (const row of events) {
    if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = drawTableHeader(doc);
    }
    doc.font('Helvetica').fontSize(8).fillColor('#000000');
    for (const col of COLUMNS) {
      doc.text(col.value(row), col.x, y, { width: col.width, ellipsis: true });
    }
    y += ROW_HEIGHT;
  }

  if (events.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).text('(no events in the requested range)', 50, y);
  }
}

function drawTableHeader(doc: PDFKit.PDFDocument): number {
  const y = TABLE_TOP;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  for (const col of COLUMNS) {
    doc.text(col.label, col.x, y, { width: col.width });
  }
  doc
    .moveTo(50, y + 12)
    .lineTo(doc.page.width - doc.page.margins.right, y + 12)
    .strokeColor('#cccccc')
    .stroke();
  return y + ROW_HEIGHT;
}
