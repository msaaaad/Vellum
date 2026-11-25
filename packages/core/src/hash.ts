import { createHash } from 'node:crypto';
import { canonicalizePayload } from './canonicalize.js';
import type { CanonicalPayload } from './types.js';

type HashAlgorithm = (prevHash: string, payload: CanonicalPayload) => string;

const HASH_ALGORITHMS: Record<number, HashAlgorithm> = {
  1: (prevHash, payload) => {
    const message = prevHash + '\n' + canonicalizePayload(payload);
    return createHash('sha256').update(message, 'utf8').digest('hex');
  },
};

export function hashEvent(prevHash: string, payload: CanonicalPayload): string {
  const algorithm = HASH_ALGORITHMS[payload.v];
  if (!algorithm) {
    throw new Error(`Unsupported hash_version: ${payload.v}`);
  }
  return algorithm(prevHash, payload);
}
