#!/usr/bin/env node
// One-command release preparation. Bumps the version, rolls the
// "[Unreleased]" changelog section into a versioned section, commits,
// tags, and pushes. The pushed tag triggers .github/workflows/release.yml,
// which builds, packages, and publishes the GitHub Release.
//
// Usage:
//   node scripts/release.mjs <patch|minor|major|X.Y.Z> [options]
//
// Options:
//   --dry-run              Print every step without writing or pushing.
//   --no-verify            Skip lint + tests (use only when CI just passed
//                          on the same commit).
//   --allow-branch <name>  Release from a branch other than main.
//
// Safety guards (all fail fast, before anything is written):
//   - working tree must be clean
//   - must be on main (or --allow-branch)
//   - HEAD must not be behind its upstream
//   - the target tag must not already exist locally or on origin

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const changelogPath = resolve(repoRoot, 'CHANGELOG.md');

const RELEASE_BRANCH = 'main';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', ...opts });
}

function git(...args) {
  return run('git', args).trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { bump: null, dryRun: false, verify: true, allowBranch: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-verify') opts.verify = false;
    else if (a === '--allow-branch') opts.allowBranch = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: release.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--no-verify] [--allow-branch <name>]');
      process.exit(0);
    } else if (a.startsWith('--')) fail(`unknown flag "${a}"`);
    else if (!opts.bump) opts.bump = a;
    else fail(`unexpected argument "${a}"`);
  }
  if (!opts.bump) fail('missing bump argument: patch | minor | major | X.Y.Z');
  return opts;
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'major') return `${major + 1}.0.0`;
  fail(`invalid bump "${bump}": expected patch, minor, major, or X.Y.Z`);
}

// ---- Changelog ------------------------------------------------------------

/**
 * Move everything under "## [Unreleased]" into a new "## [X.Y.Z] - date"
 * section and leave a fresh empty Unreleased heading on top. Returns the
 * body that was promoted (used for a preview in the console).
 */
function promoteUnreleased(changelog, version, date) {
  const marker = '## [Unreleased]';
  const idx = changelog.indexOf(marker);
  if (idx === -1) fail('CHANGELOG.md has no "## [Unreleased]" section');
  const headingEnd = changelog.indexOf('\n', idx);
  const after = changelog.slice(headingEnd + 1);
  const nextHeading = after.match(/^## \[/m);
  const bodyEnd = nextHeading ? headingEnd + 1 + nextHeading.index : changelog.length;
  const body = changelog.slice(headingEnd + 1, bodyEnd).trim();
  const releasedBody = body || '_Maintenance release; no user-facing changes._';
  const rebuilt = [
    `${marker}`,
    '',
    `## [${version}] - ${date}`,
    '',
    releasedBody,
    '',
    '',
  ].join('\n');
  return {
    changelog: changelog.slice(0, idx) + rebuilt + changelog.slice(bodyEnd),
    body: releasedBody,
  };
}

// ---- Main -----------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const version = nextVersion(pkg.version, opts.bump);
  const tag = `v${version}`;
  const today = new Date().toISOString().slice(0, 10);

  // In a dry run, guard violations are warnings so the plan can still be
  // previewed mid-work; a real run fails fast before writing anything.
  const guard = (message) => {
    if (opts.dryRun) console.warn(`release: (dry-run) would fail: ${message}`);
    else fail(message);
  };

  // -- Guards --
  if (git('status', '--porcelain') !== '') {
    guard('working tree is not clean; commit or stash first.');
  }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const expectedBranch = opts.allowBranch ?? RELEASE_BRANCH;
  if (branch !== expectedBranch) {
    guard(`on branch "${branch}" but releases come from "${expectedBranch}" (override with --allow-branch ${branch}).`);
  }
  console.log('release: fetching origin…');
  run('git', ['fetch', 'origin', '--tags'], { stdio: 'inherit' });
  try {
    const behind = git('rev-list', '--count', `HEAD..origin/${branch}`);
    if (behind !== '0') guard(`HEAD is ${behind} commit(s) behind origin/${branch}; pull first.`);
  } catch {
    // No upstream for this branch yet; the push below will create it.
  }
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
    guard(`tag ${tag} already exists.`);
  } catch {
    // Good: tag is free.
  }

  console.log(`release: ${pkg.version} -> ${version} (tag ${tag}) from ${branch}`);

  // -- Verify --
  if (opts.verify) {
    console.log('release: running lint + tests…');
    if (!opts.dryRun) {
      run('pnpm', ['lint'], { stdio: 'inherit' });
      run('pnpm', ['test'], { stdio: 'inherit' });
    }
  } else {
    console.log('release: skipping lint + tests (--no-verify).');
  }

  // -- Changelog --
  // Sweep any commits since the last tag into [Unreleased] first (idempotent:
  // commits already recorded in the changelog are skipped by their SHA).
  let lastTag = null;
  try {
    lastTag = git('describe', '--tags', '--abbrev=0');
  } catch {
    // First release: no previous tag.
  }
  if (!opts.dryRun) {
    const range = lastTag ? [lastTag, 'HEAD'] : ['HEAD'];
    run('node', ['scripts/build-changelog.mjs', ...range], { stdio: 'inherit' });
  }

  const changelog = readFileSync(changelogPath, 'utf8');
  const { changelog: nextChangelog, body } = promoteUnreleased(changelog, version, today);
  console.log(`\nrelease: notes for ${tag}:\n---\n${body}\n---\n`);

  if (opts.dryRun) {
    console.log('release: dry run; would write package.json + CHANGELOG.md,');
    console.log(`release: commit "chore(release): ${tag}", tag ${tag}, and push.`);
    return;
  }

  writeFileSync(changelogPath, nextChangelog);
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // -- Commit, tag, push --
  run('git', ['add', 'package.json', 'CHANGELOG.md']);
  run('git', ['commit', '-m', `chore(release): ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', `Ledge ${tag}`]);
  run('git', ['push', 'origin', branch, tag], { stdio: 'inherit' });

  console.log(`\nrelease: ${tag} pushed.`);
  console.log('release: the Release workflow is now building and publishing:');
  console.log('         https://github.com/olllayor/ledge/actions/workflows/release.yml');
}

main();
