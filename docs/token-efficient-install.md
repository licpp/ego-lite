# Install the token-efficient SDK and Skill

This fork changes the open-source automation SDK and Skill. The ego lite browser
application is distributed separately; keep the installed browser and its profile.
Node.js 22+ and an installed, onboarded ego lite app are required. There is no
browser rebuild, new profile, cookie migration, or npm global CLI replacement.

## macOS: persistent local installation

```bash
git clone --branch feat/token-efficient-skill https://github.com/licpp/ego-lite.git ego-lite-token-efficient
cd ego-lite-token-efficient/package/ego-browser
npm ci
npm run install:local
```

The installer builds the SDK and copies the **whole matching payload** to
`~/Library/Application Support/Citro Labs/debug/`. It also installs the compact
entry Skill in `~/.agents/skills/ego-browser`. Both existing destinations (including
symlinks) are renamed to timestamped backups before replacement. It does not
modify the app bundle or browser data. Do not install while an agent browser
script is running. New invocations load the overlay; no browser restart is needed.

Start a new agent conversation so it reads the updated entry Skill. Verify:

```bash
ego-browser skill
ego-browser nodejs -e 'await guide()'
ego-browser nodejs -e 'await guide("scripts")'
```

The guide should report `2.1.0-token-efficient.2`, and `guide()` should list four
topics. If another agent keeps its own copy of the entry Skill, point that agent
to this checkout's `skills/ego-browser/SKILL.md` (do not stack duplicate Skills).
The core guide is read once per conversation/version, not once per round.

To rebuild after pulling source changes, restore first, then install again:

```bash
npm run uninstall:local
git pull --ff-only
npm ci
npm run install:local
```

## Restore the original installation

From `package/ego-browser/` in this checkout:

```bash
npm run uninstall:local
```

This restores the exact debug directory and Skill entry that existed before
installation. The removed overlay is retained in timestamped `.removed-*`
directories, so later local edits are not deleted. An ownership marker mismatch
stops restoration instead of overwriting a different installation. Installer
state is kept in `~/.local/state/ego-browser-token-efficient/install.json`.

A debug override takes precedence over the bundled SDK after app upgrades. Restore
it before using a newly upgraded browser/runtime, then rebuild/retest this fork
against that app before reinstalling. Keep this checkout for future rebuilds and
restoration; nothing is published to npm by these commands.

## One-command trial / Windows

Build without installing a persistent override:

```bash
cd package/ego-browser
npm ci
npm run build
ego-browser nodejs --sdk-path "/absolute/checkout/package/ego-browser/dist/out/index.js" -e 'await guide()'
```

The native launcher provides `--sdk-path`; it applies only to that invocation.
Repeat it for every script using the fork. The full payload must stay together,
including `ego-browser/references/` and `agent-skills/`. On Windows use an absolute
`C:/.../dist/out/index.js` path and UTF-8 `.mjs` round files, as described by
`guide("scripts")`. The automatic persistent installer is macOS-only.

## What changes

- The default guide is about 6 KB instead of 23 KB. Conditional details remain
  available through `guide("scripts" | "spaces" | "pages" | "files")`.
- `page.snapshot({ maxChars: 6000 })` limits returned body text at whole-line
  boundaries with an explicit omission notice. The provenance header and ref
  registry are retained. Omitting the option preserves the previous full output.
  This reduces text returned to the model; it does not accelerate native capture.
- Task-local ESM helpers can be written once and imported from short round files.
  Only executed entrypoints need to remain immutable; heredocs need no files.
  `scripts/form-helpers.mjs` supplies sequential `fillFields` and a save helper
  that rejects pre-existing confirmation rather than reporting a false success.
- User-control hard stops, verification challenges, ownership checks and normal
  completion cleanup remain enforced. No persistent daemon or automatic retry
  of submissions is introduced.

The roughly 74% reduction is in default guide bytes, not a measured 76% saving in total
task tokens. Actual savings depend on which topics and Page content a task needs.

## Bounded, viewport and incremental observations

```js
// Current tab's visible viewport; maxChars bounds the body, not the header/notice.
console.log(await page.snapshot({ maxChars: 6000 }));
// First call is full; subsequent calls emit changed lines and ancestor context.
// The baseline survives separate CLI invocations in the same task and Page.
console.log(await page.snapshot({ diff: true, maxChars: 6000 }));
// Explicitly select the viewport (also the default).
console.log(await page.snapshot({ scope: "only_within_viewport", diff: true }));
// Inspect a known dialog/frame instead of the full viewport.
console.log(await page.snapshot({ scope: "subtree", root: "@21", diff: true }));
```

`diff` compares with the last completely returned diff observation. Truncated
output never advances that baseline, so the next call may repeat already shown
changes rather than silently losing unseen ones. First use, navigation (including
URL changes), scope/root or rendering-option changes establish a fresh baseline.
Reordered lines fall back to full output. An ordinary snapshot clears the diff
baseline. `maxChars` is not part of the baseline key, so it can be increased to
recover truncated changes.

Deletions are reported as counts of lines no longer observed; they are not proof
of DOM deletion, especially after scrolling. Unchanged ancestors accompany changed
lines; old refs are never printed as removal instructions. Snapshot refs still
come from the current native capture and obey the usual validity rules. With no
changes the response contains just the provenance header and a short notice.

Only line/context hashes are saved in the existing local Page ledger (one baseline
per Page, at most 20,000 lines), not previous page text. Larger snapshots return full
output and ask for narrower scope. Closing/releasing a Page or finishing the task
removes its baseline. These options reduce text returned to the model; they do not
reduce the browser's native snapshot capture work. “Viewport” means the visible
area of the selected Page, not every tab in the operating-system window.
