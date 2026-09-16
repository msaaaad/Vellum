/**
 * A user-facing failure (bad args, missing config, a business-level problem like "tenant has no
 * events") — the CLI prints just `err.message`, no stack trace. Anything else (an unexpected
 * bug) is left to bubble up with its full stack, since that's a real error to fix, not usage.
 */
export class CliError extends Error {}
