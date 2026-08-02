import { describe, expect, it } from 'vitest';
import { NESTJS_PACKAGE_VERSION } from './index';

describe('@vellum/nestjs scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(NESTJS_PACKAGE_VERSION).toBe('0.0.0');
  });
});
