import type { ChainRow, VerifyResult } from '@vellum/core';

export interface ExportManifest {
  tool: 'vellum';
  toolVersion: string;
  tenantId: string;
  range: { from: string | null; to: string | null };
  count: number;
  headHash: string | null;
  generatedAt: string;
  verify: VerifyResult;
}

export interface BuildManifestInput {
  tenantId: string;
  from: string | null;
  to: string | null;
  events: ChainRow[];
  verify: VerifyResult;
  toolVersion: string;
  clock?: () => Date;
}

export function buildManifest(input: BuildManifestInput): ExportManifest {
  const clock = input.clock ?? (() => new Date());
  return {
    tool: 'vellum',
    toolVersion: input.toolVersion,
    tenantId: input.tenantId,
    range: { from: input.from, to: input.to },
    count: input.events.length,
    headHash: input.verify.head,
    generatedAt: clock().toISOString(),
    verify: input.verify,
  };
}
