---
version: "2.1.0-token-efficient.1"
date: "2026-10-21"
---

# ego-browser

Read this guide once per conversation. Reuse it across rounds and tasks; read it
again after a runtime upgrade/override, a version mismatch, missing context, or
an explicit tool instruction. Use the installed ego lite browser and its logged-in
state; do not launch another browser or import Playwright.

## Start and resume

Run JavaScript with `ego-browser nodejs`. Bash/Zsh example:

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("user goal");
const page = task.page("p1");
await page.goto("https://example.com");
console.log({ spaceId: task.spaceId });
console.log(await page.snapshot({ maxChars: 6000 }));
EOF
```

Use exactly one TaskSpace for a goal and reuse its numeric `spaceId` and Page
labels in later invocations. Every invocation is a fresh Node.js process;
variables do not persist, while browser state and Page labels do. Reuse a Page
with `goto()` instead of creating a tab per URL. Never open a new space to bypass
a failure. All times are milliseconds; file paths must be absolute.

For an existing user tab, inspect `await listTaskSpaces()`; claim its numeric id
only when the user authorizes working there. `await task.tabs()` lists tabs;
adopt an unmanaged tab with `await task.adopt(tab.page)` before operating it.
`task.page(label)` never creates a Page. Do not inspect/select profiles unless
the user requested a particular profile.

## Read only the detail you need

`help("page.click")` prints the precise API signature and options. `await
guide("topic")` prints one matching reference; neither needs `console.log`.
Do not read every topic upfront:

| Topic                    | Read when                                                                      |
| ------------------------ | ------------------------------------------------------------------------------ |
| `await guide("scripts")` | Windows quoting, reusable task modules, script-file execution or syntax errors |
| `await guide("spaces")`  | Tab adoption, popups, handoff, user takeover or completion                     |
| `await guide("pages")`   | Unfamiliar selectors, screenshots, keyboard/mouse, page JavaScript or CDP      |
| `await guide("files")`   | Uploads, downloads, file choosers, JavaScript dialogs or browser requests      |

The API is a small custom surface, not Playwright. Use only documented Page /
TaskSpace methods. `page.evaluate(fn, argument)` runs in the Page: it cannot
read surrounding Node variables; pass one JSON-serializable argument. Node imports
and filesystem access belong outside it. Use `help()` only for an API inventory.
For installation/connection errors read the entry Skill's `references/install.md`.
Before clearing any cookies/cache/storage read `references/clearing-state.md`.

## Spend context on results

- Observe the smallest useful region. Prefer a viewport or
  `page.snapshot({ scope: "subtree", root: "@21", maxChars: 6000 })` for a known
  dialog/frame. Full-page snapshots are for discovering offscreen content.
- `maxChars` bounds snapshot **body** characters at complete lines and marks
  omissions explicitly; the Page provenance header is retained. It is opt-in for
  compatibility. Omissions are not evidence of absence. Narrow scope or extract
  the required DOM fields before increasing the budget.
- For lists, use `page.evaluate()` to return selected fields and a bounded slice,
  e.g. matching job titles/locations plus total count; do not print a hundred
  full descriptions. Do not pair a snapshot and screenshot by default.
- Batch known actions, wait for their expected result, and emit one concise
  observation. Do not re-observe a result already established by the last call.
- After navigation/DOM changes or a stale ref, take a small current snapshot.
  Prefer stable DOM selectors for reusable helpers; do not repeatedly retry refs.
- Wait for the specific new result: a new saved record, changed file id, URL or
  success state. A disappeared spinner or dispatched click alone proves nothing.
  Use `page.waitForFunction(fn, arg, { timeout: 10000 })` for a business predicate.
- Reuse task-local functions through ESM imports; later rounds need only their
  next call. Keep executed entrypoints immutable, not duplicated wholesale.
- For uploads/crops, verify the saved artifact (including all edges and readable
  content) before repeating the workflow. Do not infer completeness from a toast.

## Control and completion

Stop immediately when the user takes control or the space becomes inactive or
unassigned. Do not retry, reclaim, catch-and-continue or use CDP to bypass that
stop. Browser permission prompts, device choosers and verification challenges
require the user. Call `await task.handOff()` when handing over and end the round.
After the user explicitly asks to continue, resume the same space with
`await takeOverTaskSpace(id)`; finished/user-owned spaces require
`await claimTaskSpace(id)` instead.

When the requested result is verified, call `await task.finish({ keep: [] })`
once, last in the final round, and await it before reporting completion. Keep
only result Pages the user needs to review/continue with, e.g. `keep: ["p1"]`.
Finish invalidates all labels; never operate them afterward. Do not call finish
on a user-control stop or error. User-created/unmanaged tabs are protected.
If a CLI output contains `[ego-browser:notice]`, complete the current browser
task, report the available update, and upgrade only with user approval.
