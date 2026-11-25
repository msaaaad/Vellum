export type Diff = Record<string, [unknown, unknown]>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!deepEqual(left[key], right[key])) return false;
    }
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  return false;
}

function computeDiffAtPath(before: unknown, after: unknown, pathPrefix: string): Diff {
  const diff: Diff = {};

  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (!deepEqual(before, after)) diff[pathPrefix || '$'] = [before, after];
    return diff;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const beforeValue = before[key];
    const afterValue = after[key];
    if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
      Object.assign(diff, computeDiffAtPath(beforeValue, afterValue, path));
    } else if (!deepEqual(beforeValue, afterValue)) {
      diff[path] = [beforeValue, afterValue];
    }
  }
  return diff;
}

export function computeDiff(before: unknown, after: unknown): Diff {
  return computeDiffAtPath(before, after, '');
}
