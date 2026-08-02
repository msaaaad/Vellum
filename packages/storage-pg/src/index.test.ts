import { describe, expect, it } from 'vitest';
import { STORAGE_PG_GENESIS_HASH } from './index.js';

describe('@vellum/storage-pg scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(STORAGE_PG_GENESIS_HASH).toBe('0'.repeat(64));
  });
});
