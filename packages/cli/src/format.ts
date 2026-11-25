import type { BrokenReason, VerifyResult } from '@vellum/core';

export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function describeBrokenReason(reason: BrokenReason | undefined, seq: number | undefined): string {
  if (reason === 'GAP') return `sequence gap at seq ${seq}, a row is missing`;
  if (reason === 'LINK') return `prev_hash at seq ${seq} doesn't match the previous row's row_hash`;
  if (reason === 'HASH') return `stored row_hash at seq ${seq} != recomputed row_hash`;
  return `broken at seq ${seq}`;
}

export function formatVerifyReport(
  tenantId: string,
  result: VerifyResult,
  verifiedAt: string,
): string {
  const eventWord = result.count === 1 ? 'event' : 'events';
  const lines = [`Vellum verify - tenant ${tenantId}  (${result.count} ${eventWord})`];

  if (result.ok) {
    lines.push(`  [ok] sequence contiguous (1 ... ${result.count}, no gaps)`);
    lines.push('  [ok] every prev_hash links to the prior row');
    lines.push('  [ok] every row_hash reproduces from canonical payload + prev_hash');
    const head = result.head ? shortHash(result.head) : '(empty chain)';
    lines.push(`  RESULT: INTACT   head = ${head}   verified_at = ${verifiedAt}`);
  } else {
    lines.push(
      `  [x] BROKEN at seq ${result.brokenAt}: ${describeBrokenReason(result.brokenReason, result.brokenAt)}`,
    );
    lines.push('    -> this row (or an earlier one) was modified after it was written.');
    lines.push('  RESULT: TAMPERED');
  }

  return lines.join('\n');
}
