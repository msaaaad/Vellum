import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('run — top-level dispatch', () => {
  it('prints help and exits 1 when called with no command', async () => {
    expect(await run([])).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('prints help and exits 0 for --help / -h', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(await run(['-h'])).toBe(0);
  });

  it('prints the tool version for --version', async () => {
    expect(await run(['--version'])).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+/));
  });

  it('reports an unknown command and exits 1', async () => {
    expect(await run(['frobnicate'])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown command 'frobnicate'"));
  });

  // These reach a real command handler and hit its argument validation (a CliError) before any
  // database connection is attempted — no Docker/Postgres needed to exercise this path.
  it('prints a CliError message (not a stack trace) and exits 1 for a missing --tenant', async () => {
    expect(await run(['verify'])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('vellum: --tenant <id> is required.');
  });

  it('validates --format before ever touching the database', async () => {
    expect(await run(['export', '--tenant', 't1', '--format', 'xml'])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--format must be 'json' or 'pdf'"),
    );
  });

  it('requires a database URL for migrate when $DATABASE_URL is unset', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(await run(['migrate'])).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no database connection given'),
      );
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });
});
