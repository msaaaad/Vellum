import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './index';

describe('@vellum/core scaffold', () => {
  it('builds and exports a placeholder version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
