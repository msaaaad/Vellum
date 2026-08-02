import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from './index';

describe('@vellum/cli scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(CLI_VERSION).toBe('0.0.0');
  });
});
