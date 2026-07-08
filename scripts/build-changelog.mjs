#!/usr/bin/env node
// Build a "Keep a Changelog" section from git commits in a time window and
// merge it into CHANGELOG.md under the "## [Unreleased]" heading.
//
// Usage:
//   node scripts/build-changelog.mjs [--dry-run] [--since <date>] [--until <date>] <from-ref> [to-ref]
//
//   <from-ref> and <to-ref> define the commit range to scan (default HEAD..HEAD).
//   --since and --until further filter by committer date (ISO-8601 or
//   anything `git log --since=...` accepts).
//
// Classification (Conventional Commits prefix):
//   feat      -> Added        (user-facing)
//   fix       -> Fixed        (user-facing)
//   perf      -> Performance  (user-facing)
//   refactor  -> Changed      (user-facing: noticeable behavior change to user)
//   chore     -> Internal     (not surfaced)
//   build     -> Internal     (not surfaced)
//   docs      -> Internal     (not surfaced)
//   test      -> Internal     (not surfaced)
//   style     -> Internal     (not surfaced)
//   ci        -> Internal     (not surfaced)
//
// Idempotent: re-running with the same window won't duplicate entries because
// each commit's short SHA is recorded alongside the entry in the file.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const changelogPath = resolve(repoRoot, 'CHANGELOG.md');

// Only the types below are rendered into user-facing sections. Everything
// else (including unrecognized prefixes) is silently dropped so the digest
// stays focused on what users should know.
const USER_FACING_SECTIONS = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Performance',
  refactor: 'Changed',
};

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
}

function parseArgs(argv) {
  const opts = { dryRun: false, since: null, until: null };
  const positional = [];
  const takeValue = (arg, fallback) => {
    const eq = arg.indexOf('=');
    if (eq !== -1) return arg.slice(eq + 1);
    return fallback;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--since' || a.startsWith('--since=')) opts.since = takeValue(a, argv[++i]);
    else if (a === '--until' || a.startsWith('--until=')) opts.until = takeValue(a, argv[++i]);
    else if (a === '--from' || a.startsWith('--from=')) positional[0] = takeValue(a, argv[++i]);
    else if (a === '--to' || a.startsWith('--to=')) positional[1] = takeValue(a, argv[++i]);
    else if (a === '-h' || a === '--help') {
      console.error(
        'usage: build-changelog.mjs [--dry-run] [--since <date>] [--until <date>] <from-ref> [to-ref]',
      );
      process.exit(2);
    } else if (a.startsWith('--')) {
      console.error(`build-changelog: unknown flag "${a}"`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  opts.from = positional[0] ?? 'HEAD';
  opts.to = positional[1] ?? positional[0] ?? 'HEAD';
  return opts;
}

function getCommits(opts) {
  // %H (sha) and %s (subject) are always single-line, so we emit them on
  // two consecutive lines and parse in pairs. We deliberately skip the
  // commit body (%b) because its trailing newlines can corrupt a NUL
  // separator in a single-line format string.
  const format = '%H%n%s';
  const args = ['log', '--no-merges', '--no-patch', `--pretty=format:${format}`];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(`${opts.from}..${opts.to}`);
  const raw = run('git', args);
  if (!raw) return [];
  const lines = raw.split('\n').filter((line) => line.length > 0);
  const commits = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const sha = lines[i];
    const subject = lines[i + 1];
    if (/^[0-9a-f]{40}$/.test(sha)) {
      commits.push({ sha, subject: subject.trim() });
    }
  }
  return commits;
}

function classify(subject) {
  const m = subject.match(/^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<rest>.+)$/i);
  if (!m) return { type: 'other', scope: null, rest: subject };
  return {
    type: m.groups.type.toLowerCase(),
    scope: m.groups.scope || null,
    bang: Boolean(m.groups.bang),
    rest: m.groups.rest.trim(),
  };
}

function buildSection(commits) {
  const groups = { Added: [], Fixed: [], Performance: [], Changed: [] };
  for (const c of commits) {
    const meta = classify(c.subject);
    const label = USER_FACING_SECTIONS[meta.type];
    if (!label) continue;
    const scopePrefix = meta.scope ? `**${meta.scope}**: ` : '';
    const bang = meta.bang ? ' ⚠️ BREAKING' : '';
    groups[label].push(`- ${scopePrefix}${meta.rest}${bang} (\`${c.sha.slice(0, 7)}\`)`);
  }
  const out = [];
  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    out.push(`### ${label}`, ...items, '');
  }
  return out.join('\n');
}

function readChangelog() {
  if (!existsSync(changelogPath)) {
    return [
      '# Changelog',
      '',
      'All notable changes to Ledge will be documented in this file.',
      '',
      'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
      'and this project adheres to [Semantic Versioning](https://semver.org/).',
      '',
      '## [Unreleased]',
      '',
    ].join('\n');
  }
  return readFileSync(changelogPath, 'utf8');
}

function extractSeenShas(changelog) {
  const matches = changelog.matchAll(/\(`([0-9a-f]{7,})`\)/g);
  return new Set([...matches].map((m) => m[1]));
}

function findUnreleasedSection(changelog) {
  const marker = '## [Unreleased]';
  const idx = changelog.indexOf(marker);
  if (idx === -1) return null;
  const after = changelog.slice(idx + marker.length);
  const nextHeading = after.match(/^## \[/m);
  const end = nextHeading ? idx + marker.length + nextHeading.index : changelog.length;
  return { start: idx, end };
}

function upsertUnreleased(existing, sectionBody) {
  const section = findUnreleasedSection(existing);
  if (!section) {
    const today = new Date().toISOString().slice(0, 10);
    return existing.replace(/(\n*)$/, `\n## [Unreleased] - ${today}\n\n${sectionBody}\n`);
  }
  const head = existing.slice(0, section.start);
  const tail = existing.slice(section.end);
  const headingLine = existing
    .slice(section.start, section.end)
    .split('\n')[0]
    .trimEnd();
  const rebuilt = `${headingLine}\n\n${sectionBody}\n`;
  return head + rebuilt + tail;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    run('git', ['rev-parse', '--verify', `${opts.from}^{commit}`]);
  } catch {
    console.error(`build-changelog: ref "${opts.from}" does not exist; nothing to do.`);
    process.exit(0);
  }

  const commits = getCommits(opts);
  if (commits.length === 0) {
    console.log('build-changelog: no commits in window; nothing to do.');
    process.exit(0);
  }

  const existing = readChangelog();
  const seen = extractSeenShas(existing);
  const fresh = commits.filter((c) => {
    const short = c.sha.slice(0, 7);
    return !seen.has(short) && !seen.has(c.sha);
  });
  if (fresh.length === 0) {
    console.log(`build-changelog: all ${commits.length} commits already in CHANGELOG.md.`);
    process.exit(0);
  }

  const body = buildSection(fresh);
  if (!body.trim()) {
    console.log('build-changelog: no user-visible changes in window; nothing to do.');
    process.exit(0);
  }

  if (opts.dryRun) {
    const rendered = upsertUnreleased(existing, body);
    process.stdout.write(rendered);
    return;
  }

  const next = upsertUnreleased(existing, body);
  writeFileSync(changelogPath, next);
  console.log(
    `build-changelog: added ${fresh.length} entr${fresh.length === 1 ? 'y' : 'ies'} to CHANGELOG.md.`,
  );
}

main();
