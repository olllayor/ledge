#!/usr/bin/env node
// Print the CHANGELOG.md body for one released version, for use as the
// GitHub Release description.
//
// Usage: node scripts/release-notes.mjs <X.Y.Z | vX.Y.Z>
//
// Prints the section body to stdout. Exits 0 with a fallback line when the
// version has no section, so the release job never fails on missing notes.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, '..', 'CHANGELOG.md');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: release-notes.mjs <X.Y.Z | vX.Y.Z>');
  process.exit(2);
}
const version = raw.replace(/^v/, '');

if (!existsSync(changelogPath)) {
  console.log(`Ledge v${version}`);
  process.exit(0);
}

const changelog = readFileSync(changelogPath, 'utf8');
const headingPattern = new RegExp(
  `^## \\[${version.replace(/\./g, '\\.')}\\][^\n]*$`,
  'm',
);
const match = changelog.match(headingPattern);
if (!match) {
  console.log(`Ledge v${version}`);
  process.exit(0);
}

const start = match.index + match[0].length;
const rest = changelog.slice(start);
const nextHeading = rest.match(/^## \[/m);
const body = rest.slice(0, nextHeading ? nextHeading.index : rest.length).trim();

console.log(body || `Ledge v${version}`);
