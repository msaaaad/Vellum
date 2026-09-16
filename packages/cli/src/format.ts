import type { BrokenReason, VerifyResult } from '@vellum/core';

/** `9f2c3e…a71b` — a full 64-hex-char hash is unreadable in a terminal; this is what a human scans. */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function brokenReasonMessage(reason: BrokenReason | undefined, seq: number | undefined): string {
  switch (reason) {
    case 'GAP':
      return `sequence gap at seq ${seq} — a row is missing`;
    case 'LINK':
      return `prev_hash at seq ${seq} doesn't match the previous row's row_hash`;
    case 'HASH':
      return `stored row_hash at seq ${seq} ≠ recomputed row_hash`;
    default:
      return `broken at seq ${seq}`;
  }
}

/** README "Verifying integrity" — the human-readable `vellum verify` report. */
export function formatVerifyReport(
  tenantId: string,
  result: VerifyResult,
  verifiedAt: string,
): string {
  const eventWord = result.count === 1 ? 'event' : 'events';
  const lines = [`Vellum verify — tenant ${tenantId}  (${result.count} ${eventWord})`];

  if (result.ok) {
    lines.push(`  ✔ sequence contiguous (1 … ${result.count}, no gaps)`);
    lines.push('  ✔ every prev_hash links to the prior row');
    lines.push('  ✔ every row_hash reproduces from canonical payload + prev_hash');
    const head = result.head ? shortHash(result.head) : '(empty chain)';
    lines.push(`  RESULT: INTACT   head = ${head}   verified_at = ${verifiedAt}`);
  } else {
    lines.push(
      `  ✗ BROKEN at seq ${result.brokenAt}: ${brokenReasonMessage(result.brokenReason, result.brokenAt)}`,
    );
    lines.push('    → this row (or an earlier one) was modified after it was written.');
    lines.push('  RESULT: TAMPERED');
  }

  return lines.join('\n');
}
