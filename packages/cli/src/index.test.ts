import { describe, expect, it } from 'vitest';
import { CLI_GENESIS_HASH } from './index.js';

describe('@vellum/cli scaffold', () => {
  it('resolves the @vellum/core workspace dependency', () => {
    expect(CLI_GENESIS_HASH).toBe('0'.repeat(64));
  });
});
