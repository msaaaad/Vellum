function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deleteAtPath(target: Record<string, unknown>, segments: string[]): void {
  const [head, ...rest] = segments;
  if (head === undefined || !(head in target)) return;
  if (rest.length === 0) {
    delete target[head];
    return;
  }
  const nested = target[head];
  if (isPlainObject(nested)) deleteAtPath(nested, rest);
}

export function redact<T>(value: T, paths: string[]): T {
  if (paths.length === 0 || !isPlainObject(value)) return value;
  const clone = structuredClone(value) as Record<string, unknown>;
  for (const path of paths) {
    deleteAtPath(clone, path.split('.'));
  }
  return clone as T;
}
