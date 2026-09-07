export type Diff = Record<string, [unknown, unknown]>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}

/**
 * README "Diffs (before/after)": the default diff strategy. Shallow+nested — recurses into
 * matching plain-object keys, flattening changed leaves to dot-paths (`'address.city'`) rather
 * than diffing whole sub-objects wholesale. Non-object leaves (including arrays) are compared
 * by deep equality, not recursed into.
 */
export function computeDiff(before: unknown, after: unknown, prefix = ''): Diff {
  const diff: Diff = {};

  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (!deepEqual(before, after)) diff[prefix || '$'] = [before, after];
    return diff;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const beforeVal = before[key];
    const afterVal = after[key];
    if (isPlainObject(beforeVal) && isPlainObject(afterVal)) {
      Object.assign(diff, computeDiff(beforeVal, afterVal, path));
    } else if (!deepEqual(beforeVal, afterVal)) {
      diff[path] = [beforeVal, afterVal];
    }
  }
  return diff;
}
