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
builds the DMG, signs + notarizes it, verifies the artifacts, and
publishes a GitHub Release whose notes come from `CHANGELOG.md`.

[Release workflow]: https://github.com/olllayor/ledge/actions/workflows/release.yml

## The moving parts

| Piece | What it does |
| --- | --- |
| `pnpm release <bump>` | Local one-command release prep (`scripts/release.mjs`). |
| `.github/workflows/release.yml` | Triggered by the `vX.Y.Z` tag. Lint + test gate, signing/notarization policy, `pnpm dist:release`, DMG notarization, artifact verification, publishes the Release. |
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
4. **Watch the workflow.** ~15–30 min on the macOS runner (Apple
   notarization of the `.app` plus the DMG is the slow part). It re-runs
   lint/tests, enforces the signing policy, builds (`pnpm dist:release`
   → signed + notarized `.app` → `hdiutil` DMG → notarized DMG),
   verifies codesign / Gatekeeper / staples, and publishes the GitHub
   Release with the DMG attached.
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
  `package.json`, creating the tag if missing. Leave `allow_unsigned`
  unchecked for a normal public release.
- **CI died mid-release:** fix the cause and re-run the failed workflow
  run. The tag already exists; nothing else needs to be redone.
- **Bad tag pushed:** `git push origin :refs/tags/vX.Y.Z`, delete the
  draft/broken GitHub Release, fix, and `pnpm release X.Y.Z` again
  (versions are cheap — prefer bumping again over reusing a tag that
  anyone may have fetched).
- **Hotfix:** branch from the release tag, cherry-pick the fix, merge to
  `main`, then `pnpm release patch` as usual.
- **Fully local build (no CI):** `pnpm dist:release` produces the DMG in
  `dist/`; it does not tag or publish anything. Local builds sign and
  notarize only if you export `CSC_*` / `APPLE_*` yourself.

## Code signing & notarization (required for public releases)

Tag-driven releases **fail** when signing or notarization secrets are
missing. The workflow refuses to silently ship an ad-hoc unsigned DMG.

### Required repository secrets

Add these under *Settings → Secrets and variables → Actions*:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of your Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`). |
| `CSC_KEY_PASSWORD` | The `.p12` password. |
| `APPLE_ID` | Apple ID email of the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com. |
| `APPLE_TEAM_ID` | 10-character team ID. |

All five are required together for a public release:

- `CSC_LINK` / `CSC_KEY_PASSWORD` make electron-builder sign the app
  bundle with a Developer ID Application certificate (hardened runtime
  is already enabled in `package.json → build.mac`). Empty values are
  left unset rather than exported, because electron-builder treats a
  defined-but-empty `CSC_LINK` as a real cert path.
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` enable
  electron-builder's auto-notarize of the **`.app`** during
  `pnpm dist:release` (submit + wait + staple), and gate the later
  `notarytool submit --wait` + `stapler staple` step on the **DMG**.
  All three must be present; a partial set is a hard error.

### What the workflow enforces

1. **Policy step** — fails the job before the build if secrets are
   missing or partially configured, unless the unsigned escape hatch is
   active. Only non-empty secrets are exported into the job environment.
2. **Build & Package** — electron-builder signs the `.app`, notarizes
   it, and staples it; `scripts/build-dmg.mjs` then packs that stapled
   `.app` into the DMG.
3. **Notarize DMG** — `notarytool submit --wait` + `stapler staple` on
   the disk image.
4. **Verify release artifacts** — fails the job (and therefore skips
   upload/publish) unless all of these pass:
   - `codesign --verify --deep --strict` on `Ledge.app`
   - `test -x` on `Contents/Resources/native/DropShelfNativeAgent`
   - when signed: `codesign -dv` reports a `Developer ID Application`
     identity (not ad-hoc)
   - when notarized: `spctl --assess --type execute` on the `.app`, and
     `xcrun stapler validate` on both the `.app` and the DMG

### Unsigned escape hatch (`allow_unsigned`)

For non-public experiments only: run the workflow via
*Actions → Release → Run workflow* and check **allow_unsigned**. That
skips the missing-secret failure, builds an ad-hoc unsigned DMG, and
skips Gatekeeper / staple checks.

Tag pushes never honor `allow_unsigned` — a published `vX.Y.Z` release
always requires signing + notarization.

## Versioning

Semantic-ish for a pre-1.0 app:

- **patch** — bug fixes, polish, internal changes users shouldn't notice.
- **minor** — new user-facing features (a new window, new preference).
- **major** — reserved for 1.0 and breaking data-format changes.

The release workflow refuses a tag that doesn't match
`package.json.version`, so the version bump and the tag can never drift.

## Pre-release smoke checklist

CI already fails the release on broken codesign / Gatekeeper / staple
checks. Still smoke-test the published DMG:

- [ ] `codesign --verify --deep --strict /Applications/Ledge.app` passes.
- [ ] `codesign -dv /Applications/Ledge.app` shows `Developer ID Application`.
- [ ] `spctl --assess --type execute --verbose /Applications/Ledge.app` is `accepted`.
- [ ] `xcrun stapler validate /Applications/Ledge.app` says the ticket is present.
- [ ] `xcrun stapler validate Ledge-*.dmg` (on the downloaded DMG) is valid.
- [ ] Fresh install from the DMG opens without a crash; menu-bar icon appears.
- [ ] Onboarding shows on a fresh profile (`rm -rf ~/Library/Application\ Support/Ledge` first).
- [ ] Copy a few items → they appear in clipboard history once (no duplicates).
- [ ] ⌘⇧V quick-paste palette opens, pastes, and Clear empties the list live.
- [ ] Drag a file out of the peek window.
- [ ] Shake gesture summons the shelf (Accessibility permission flow).
- [ ] Preferences → change the global shortcut → both it and the clipboard hotkeys still work.
