import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const tsc = resolve(repoRoot, 'node_modules/.bin/tsc');
const vite = resolve(repoRoot, 'node_modules/.bin/vite');

if (!existsSync(tsc) || !existsSync(vite)) {
  console.error(
    `\n  Missing node_modules — run 'pnpm install --frozen-lockfile' first.\n` +
    `  (checked for ${tsc})\n`
  );
  process.exit(2);
}
