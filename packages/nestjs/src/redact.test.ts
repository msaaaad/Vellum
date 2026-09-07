import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

describe('redact', () => {
  it('strips a top-level path', () => {
    const input = { name: 'Sam', signatureImage: 'data:...' };
    expect(redact(input, ['signatureImage'])).toEqual({ name: 'Sam' });
  });

  it('strips a nested dot-path without touching sibling keys', () => {
    const input = { bank: { accountNumber: '123', bsb: '456' }, name: 'Sam' };
    expect(redact(input, ['bank.accountNumber'])).toEqual({ bank: { bsb: '456' }, name: 'Sam' });
  });

  it('is a no-op when the path does not exist', () => {
    const input = { name: 'Sam' };
    expect(redact(input, ['nope', 'also.nope'])).toEqual({ name: 'Sam' });
  });

  it('does not mutate the original object', () => {
    const input = { secret: 'x' };
    const result = redact(input, ['secret']);
    expect(input).toEqual({ secret: 'x' });
    expect(result).toEqual({});
  });

  it('passes through non-plain-object values unchanged', () => {
    expect(redact(null, ['x'])).toBeNull();
    expect(redact(undefined, ['x'])).toBeUndefined();
    expect(redact('hello', ['x'])).toBe('hello');
    expect(redact([1, 2, 3], ['0'])).toEqual([1, 2, 3]);
  });

  it('returns the same reference when there are no paths to strip', () => {
    const input = { a: 1 };
    expect(redact(input, [])).toBe(input);
  });
});
