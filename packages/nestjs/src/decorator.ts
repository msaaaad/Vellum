import { SetMetadata } from '@nestjs/common';
import { AUDITED_METADATA_KEY } from './tokens.js';
import type { AuditedOptions } from './types.js';

/**
 * Marks a method for automatic audit capture — README "The @Audited() decorator". Pure
 * metadata; `AuditInterceptor` (registered globally by `AuditModule`) does the actual work.
 */
export const Audited = (options: AuditedOptions): MethodDecorator =>
  SetMetadata(AUDITED_METADATA_KEY, options);
