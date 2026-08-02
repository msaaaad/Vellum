import { describe, expect, it } from 'vitest';
import { STORAGE_PG_PACKAGE_VERSION } from './index';

describe('@vellum/storage-pg scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(STORAGE_PG_PACKAGE_VERSION).toBe('0.0.0');
  });
});
