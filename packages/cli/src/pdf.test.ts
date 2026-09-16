import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChainRow } from '@vellum/core';
import { buildManifest } from './manifest.js';
import { coverStampFor, renderEvidencePackPdf } from './pdf.js';

function fakeRow(seq: number, action: string): ChainRow {
  return {
    tenantId: 't1',
    seq,
    occurredAt: '2026-01-01T00:00:00.000Z',
    actor: { id: 'u1', type: 'user', label: 'sam@x.io' },
    action,
    entity: { type: 'Thing', id: `t-${seq}` },
    changes: {},
    metadata: {},
    hashVersion: 1,
    prevHash: '0'.repeat(64),
    rowHash: 'a'.repeat(64),
  };
}

describe('coverStampFor', () => {
  it('stamps VERIFIED for an intact chain', () => {
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [],
      verify: { ok: true, count: 3, head: 'a'.repeat(64) },
      toolVersion: '0.0.0',
    });
    expect(coverStampFor(manifest)).toEqual({
      label: 'VERIFIED',
      color: expect.any(String),
      verifyLine: 'INTACT',
    });
  });

  it('stamps FAILED with the seq/reason for a broken chain', () => {
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [],
      verify: { ok: false, count: 5, head: null, brokenAt: 3, brokenReason: 'HASH' },
      toolVersion: '0.0.0',
    });
    expect(coverStampFor(manifest)).toEqual({
      label: 'FAILED',
      color: expect.any(String),
      verifyLine: 'TAMPERED at seq 3 (HASH)',
    });
  });

  it('uses different colors for VERIFIED and FAILED', () => {
    const verified = coverStampFor(
      buildManifest({
        tenantId: 't1',
        from: null,
        to: null,
        events: [],
        verify: { ok: true, count: 0, head: null },
        toolVersion: '0.0.0',
      }),
    );
    const failed = coverStampFor(
      buildManifest({
        tenantId: 't1',
        from: null,
        to: null,
        events: [],
        verify: { ok: false, count: 0, head: null, brokenAt: 1, brokenReason: 'GAP' },
        toolVersion: '0.0.0',
      }),
    );
    expect(verified.color).not.toBe(failed.color);
  });
});

describe('renderEvidencePackPdf', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vellum-pdf-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a well-formed, non-trivial PDF file', async () => {
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [fakeRow(1, 'consent.granted')],
      verify: { ok: true, count: 1, head: 'a'.repeat(64) },
      toolVersion: '0.0.0',
    });

    const outPath = join(dir, 'pack.pdf');
    await renderEvidencePackPdf(outPath, manifest, [fakeRow(1, 'consent.granted')]);

    const bytes = await readFile(outPath);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.toString('latin1')).toMatch(/%%EOF\s*$/);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('handles an empty event list without throwing', async () => {
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [],
      verify: { ok: true, count: 0, head: null },
      toolVersion: '0.0.0',
    });

    const outPath = join(dir, 'pack-empty.pdf');
    await expect(renderEvidencePackPdf(outPath, manifest, [])).resolves.toBeUndefined();
    const bytes = await readFile(outPath);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a broken-chain pack too — a tamper attempt is evidence, not a dead end', async () => {
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: [fakeRow(1, 'thing.done')],
      verify: { ok: false, count: 5, head: null, brokenAt: 3, brokenReason: 'HASH' },
      toolVersion: '0.0.0',
    });

    const outPath = join(dir, 'pack-failed.pdf');
    await renderEvidencePackPdf(outPath, manifest, [fakeRow(1, 'thing.done')]);
    const bytes = await readFile(outPath);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('paginates the event table across multiple pages once it overflows one page', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => fakeRow(i + 1, 'thing.done'));
    const manifest = buildManifest({
      tenantId: 't1',
      from: null,
      to: null,
      events: manyRows,
      verify: { ok: true, count: 60, head: 'a'.repeat(64) },
      toolVersion: '0.0.0',
    });

    const outPath = join(dir, 'pack-many.pdf');
    await renderEvidencePackPdf(outPath, manifest, manyRows);

    const text = (await readFile(outPath)).toString('latin1');
    // Each page object declares /Type /Page (singular) — /Type /Pages is the tree root, excluded
    // by requiring the next char not be 's'.
    const pageCount = (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(2); // cover + at least 2 table pages
  });
});
