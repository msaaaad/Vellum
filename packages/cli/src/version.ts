import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

/** The CLI's own version — recorded in every export manifest so a pack names the tool that made it. */
export function getToolVersion(): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}
