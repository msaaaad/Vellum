import { runCheckpoint } from './commands/checkpoint.js';
import { runExport } from './commands/export.js';
import { runMigrate } from './commands/migrate.js';
import { runVerify } from './commands/verify.js';
import { CliError } from './errors.js';
import { getToolVersion } from './version.js';

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  migrate: runMigrate,
  verify: runVerify,
  export: runExport,
  checkpoint: runCheckpoint,
};

const HELP = `Vellum — tamper-evident, tenant-scoped audit trails for NestJS + PostgreSQL.

Usage:
  vellum migrate [--database-url <url>]
  vellum verify --tenant <id> [--from <seq>] [--to <seq>] [--json] [--database-url <url>]
  vellum export --tenant <id> --format json|pdf [--from <date>] [--to <date>] [--out <path>] [--database-url <url>]
  vellum checkpoint --tenant <id> [--anchored-ref <ref>] [--database-url <url>]

Options:
  --database-url <url>   Postgres connection string (default: $DATABASE_URL)
  -h, --help              Show this help
  --version                Show the tool version
`;

/**
 * The whole CLI, minus process wiring (argv slicing, exit code, stderr formatting) — kept
 * separate from `index.ts` so it's callable directly in tests without spawning a process.
 * Returns the process exit code; never calls `process.exit()` itself.
 */
export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === '--version') {
    console.log(getToolVersion());
    return 0;
  }
  if (!command || command === '-h' || command === '--help') {
    console.log(HELP);
    return command ? 0 : 1;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`vellum: unknown command '${command}'\n`);
    console.error(HELP);
    return 1;
  }

  try {
    return await handler(rest);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`vellum: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
