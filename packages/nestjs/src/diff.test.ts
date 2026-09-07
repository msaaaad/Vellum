import { describe, expect, it } from 'vitest';
import { computeDiff } from './diff.js';

describe('computeDiff', () => {
  it('reports only the fields that changed', () => {
    const before = { name: 'Old', age: 30 };
    const after = { name: 'New', age: 30 };
    expect(computeDiff(before, after)).toEqual({ name: ['Old', 'New'] });
  });

  it('flattens nested object changes to dot-paths', () => {
    const before = { address: { city: 'Perth', state: 'WA' } };
    const after = { address: { city: 'Sydney', state: 'WA' } };
    expect(computeDiff(before, after)).toEqual({ 'address.city': ['Perth', 'Sydney'] });
  });

  it('reports added and removed keys', () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    expect(computeDiff(before, after)).toEqual({ b: [undefined, 2] });
  });

  it('treats an unchanged nested array as equal (deep equality, not identity)', () => {
    const before = { tags: ['a', 'b'] };
    const after = { tags: ['a', 'b'] };
    expect(computeDiff(before, after)).toEqual({});
  });

  it('reports a changed array as a single leaf diff', () => {
    const before = { tags: ['a', 'b'] };
    const after = { tags: ['a', 'c'] };
    expect(computeDiff(before, after)).toEqual({
      tags: [
        ['a', 'b'],
        ['a', 'c'],
      ],
    });
  });

  it('returns {} for two identical objects', () => {
    expect(computeDiff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual({});
  });
});
