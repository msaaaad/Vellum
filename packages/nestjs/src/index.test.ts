import { describe, expect, it } from 'vitest';
import { NESTJS_PACKAGE_GENESIS_HASH } from './index.js';

describe('@vellum/nestjs scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(NESTJS_PACKAGE_GENESIS_HASH).toBe('0'.repeat(64));
  });
});
