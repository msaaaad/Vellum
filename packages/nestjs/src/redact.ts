function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deleteAtPath(obj: Record<string, unknown>, segments: string[]): void {
  const [head, ...rest] = segments;
  if (head === undefined || !(head in obj)) return;
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  const next = obj[head];
  if (isPlainObject(next)) deleteAtPath(next, rest);
}

/**
 * Deep-clones `value` and strips every dot-path in `paths` (e.g. `'signatureImage'`,
 * `'bank.accountNumber'`). The hash is computed over this redacted form — ARCHITECTURE.md §8.7 —
 * so what you can later verify is exactly what you chose to keep.
 */
export function redact<T>(value: T, paths: string[]): T {
  if (paths.length === 0 || !isPlainObject(value)) return value;
  const clone = structuredClone(value) as Record<string, unknown>;
  for (const path of paths) {
    deleteAtPath(clone, path.split('.'));
  }
  return clone as T;
}
