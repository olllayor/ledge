# Releasing Ledge

One command prepares a release; a tag push publishes it. Everything else
(changelog, version, tag, GitHub Release, DMG) is automated.

## TL;DR

```bash
git checkout main && git pull
pnpm release patch        # or: minor | major | 0.2.0
```

That's it. The script bumps the version, rolls the changelog, commits,
tags `vX.Y.Z`, and pushes. The [Release workflow] then lints, tests,
builds the DMG, and publishes a GitHub Release whose notes come from
`CHANGELOG.md`.

[Release workflow]: https://github.com/olllayor/ledge/actions/workflows/release.yml

## The moving parts

| Piece | What it does |
| --- | --- |
| `pnpm release <bump>` | Local one-command release prep (`scripts/release.mjs`). |
| `.github/workflows/release.yml` | Triggered by the `vX.Y.Z` tag. Lint + test gate, `pnpm dist:release`, optional notarization, publishes the Release. |
| `.github/workflows/ci.yml` | Lint + test + build on every PR and push to `main`/`dev`. |
| `.github/workflows/changelog-nightly.yml` | Nightly PR that drafts `CHANGELOG.md` entries from Conventional Commits on `main`. |
| `scripts/build-changelog.mjs` | Converts `feat:`/`fix:`/`perf:`/`refactor:` commits into Keep-a-Changelog sections under `## [Unreleased]`. |
| `scripts/release-notes.mjs` | Extracts one version's section from `CHANGELOG.md` for the Release body. |

## Standard flow

1. **Land work on `dev`, merge to `main`.** Use Conventional Commit
   subjects (`feat:`, `fix:`, `perf:`, `refactor:` are user-facing and
   feed the changelog; `chore:`/`docs:`/`test:`/`ci:` are ignored).
2. **Let the changelog fill itself.** The nightly workflow opens a PR
   with new `[Unreleased]` entries; merge or edit it. You can also run
   `pnpm changelog:diff <ref>` locally to preview.
3. **Release from a clean `main`:**

   ```bash
   pnpm release patch
   ```

   The script fails fast if the tree is dirty, you're not on `main`,
   you're behind `origin/main`, or the tag already exists. It then:
   - runs `pnpm lint` + `pnpm test` (skip with `--no-verify` only when
     CI just passed on the same commit),
   - sweeps any not-yet-recorded commits since the last tag into
     `[Unreleased]`,
   - promotes `[Unreleased]` to `## [X.Y.Z] - <date>` (shown in the
     console — this becomes the release notes),
   - bumps `package.json`, commits `chore(release): vX.Y.Z`, tags, and
     pushes branch + tag.
4. **Watch the workflow.** ~10–15 min on the macOS runner. It re-runs
   lint/tests, builds (`pnpm dist:release` → signed/unsigned `.app` →
   `hdiutil` DMG), notarizes if secrets are configured, and publishes
   the GitHub Release with the DMG attached.
5. **Smoke-test the artifact.** Download the DMG from the Release,
   install, and run the quick checklist below.

### Dry run

```bash
pnpm release:dry                     # patch bump, prints the plan
node scripts/release.mjs minor --dry-run
```

Prints the version, the notes that would ship, and the steps — writes
nothing, pushes nothing.

## Manual / recovery paths

- **Re-publish without a new commit:** run the Release workflow via
  *Actions → Release → Run workflow*. It releases the version already in
  `package.json`, creating the tag if missing.
- **CI died mid-release:** fix the cause and re-run the failed workflow
  run. The tag already exists; nothing else needs to be redone.
- **Bad tag pushed:** `git push origin :refs/tags/vX.Y.Z`, delete the
  draft/broken GitHub Release, fix, and `pnpm release X.Y.Z` again
  (versions are cheap — prefer bumping again over reusing a tag that
  anyone may have fetched).
- **Hotfix:** branch from the release tag, cherry-pick the fix, merge to
  `main`, then `pnpm release patch` as usual.
- **Fully local build (no CI):** `pnpm dist:release` produces the DMG in
  `dist/`; it does not tag or publish anything.

## Code signing & notarization (optional but recommended)

Without these secrets the workflow still ships an **unsigned** DMG
(users must right-click → Open on first launch). To ship a signed,
notarized build, add these repository secrets
(*Settings → Secrets and variables → Actions*):

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of your Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`). |
| `CSC_KEY_PASSWORD` | The `.p12` password. |
| `APPLE_ID` | Apple ID email of the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com. |
| `APPLE_TEAM_ID` | 10-character team ID. |

`CSC_LINK`/`CSC_KEY_PASSWORD` make electron-builder sign the app bundle
(hardened runtime is already enabled in `package.json → build.mac`). The
three `APPLE_*` secrets gate the `notarytool submit --wait` + `stapler`
step — all three must be present.

## Versioning

Semantic-ish for a pre-1.0 app:

- **patch** — bug fixes, polish, internal changes users shouldn't notice.
- **minor** — new user-facing features (a new window, new preference).
- **major** — reserved for 1.0 and breaking data-format changes.

The release workflow refuses a tag that doesn't match
`package.json.version`, so the version bump and the tag can never drift.

## Pre-release smoke checklist

- [ ] Fresh install from the DMG opens without a crash; menu-bar icon appears.
- [ ] Onboarding shows on a fresh profile (`rm -rf ~/Library/Application\ Support/Ledge` first).
- [ ] Copy a few items → they appear in clipboard history once (no duplicates).
- [ ] ⌘⇧V quick-paste palette opens, pastes, and Clear empties the list live.
- [ ] Drag a file out of the peek window.
- [ ] Shake gesture summons the shelf (Accessibility permission flow).
- [ ] Preferences → change the global shortcut → both it and the clipboard hotkeys still work.
