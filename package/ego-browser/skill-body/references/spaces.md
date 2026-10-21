## Spaces, rounds, and pages

- Use exactly one TaskSpace for the entire user goal. Create it once, print its
  `spaceId`, and resume that same space in later rounds. Use multiple spaces
  only when the user explicitly requests them.
- Task space names are unique. `taskSpace(name)` resumes your own space with
  that name instead of creating a second one. If the name belongs to a
  user-owned space, it fails with `EGO_TASK_SPACE_NAME_IN_USE`: ask the user
  whether to work in that space (then `claimTaskSpace(id)`), or pick another
  name.
- Never use a new TaskSpace to recover from a stuck, blocked, timed-out, or
  unexpected Page. Recover within the existing space; if it cannot continue,
  stop and ask the user.
- Every invocation starts a new Node.js process. Task spaces, tabs, and Page labels
  persist; JavaScript variables do not.
- A new task space starts with Page `p1`; navigate it instead of opening
  another Page.
- Reuse a Page with `goto()` instead of opening a new Page for every URL.
- All time values are milliseconds.

```js
// Later round: use the space id and Page label printed earlier.
const resumed = await taskSpace(7);
const source = resumed.page("p1");
await source.goto("https://example.com/releases");
```

Do not inspect or select profiles unless the user explicitly requests a
particular Ego Lite profile. A `profileId` applies only when creating a space;
use `help("profiles")` for the exact workflow.

Supported TaskSpace API:

- State: `spaceId`, `name`, `ownership`, `page(label)`, `userPage()`
- Pages: `await task.pages()`, `await task.tabs()`, `newPage()`,
  `adopt(page, { as? })`, `release(label)`
- Control: `waitForControl(options)`, `handOff()`, `finish({ keep })`
- Advanced: `cdp(method, params, options)`

Pages receive permanent labels such as `p1`, `p2`, and `p3`. Prefer these labels
to custom `{ as }` values. Reuse or close Pages as the task proceeds; the runtime
reports the configured Page budget when it is reached.

`task.newPage()` creates another blank Page when multiple Pages must stay open.
Navigate it separately with `page.goto()`.

`task.page(label)` only refers to a Page that already exists; it never creates
one, and its handle is always truthy, so `task.page("p2") || await task.newPage()`
and `if (!page)` do not detect a missing label. Use labels printed by earlier
output or by `await task.pages()`, and call `await task.newPage()` to create one.

`await task.pages()` returns managed Pages. `await task.tabs()` returns every tab in the
space as `{ label?, page, targetId, title, url, active, openedBy }`. A tab
without a label is unmanaged; adopt it before operating:

```js
const active = (await task.tabs()).find((item) => item.active);
if (active && !active.label) {
  const page = await task.adopt(active.page);
  console.log({ page: page.label, url: await page.url() });
}
```

`release(label)` returns an unknown-origin Page to the user without closing its
tab. Close Agent-created Pages with `page.close()`. Treat `openedBy: "unknown"`
as user-owned when deciding whether a Page may be closed.

## User control and completion

Stop when the user takes control or the space is inactive or unassigned. Do not
retry or route around the stop. Permission prompts, device choosers, and
other browser-owned prompts require the user to handle them.

When the user must act in the browser, call `await task.handOff()`, end the
round, and explain what they should do. After the user confirms, resume the
same space:

```js
const task = await takeOverTaskSpace(7);
const userPage = task.userPage();
```

Adopt `userPage` if it is unmanaged. Use `waitForControl()` only when the current
script must wait in place. Claim a user-owned or inactive space only when the
user explicitly asks; this includes a space you finished with kept Pages, which
`takeOverTaskSpace()` cannot resume. Find its numeric id first; names may be
duplicated. `listTaskSpaces()` entries expose that id as `id` (`spaceId` exists
only on a TaskSpace handle), so pass `entry.id` to `claimTaskSpace()` or
`taskSpace()`:

```js
const spaces = await listTaskSpaces();
console.log(spaces.filter((space) => space.ownership === "user"));

const task = await claimTaskSpace(7);
const userPage = task.userPage();
```

When the task succeeds, close the TaskSpace by default with
`await task.finish({ keep: [] })`. Call `finish()` exactly once and wait for it
to resolve before reporting completion.

`finish()` ends the task and all of its Page labels, including Pages kept for the
user. Put it last in the final round only; do not operate any Page after it in
the same script or in later rounds.

Keeping Pages is a rare exception: retain only necessary Pages when the user
explicitly asks, or when the result must remain in the browser for the user to
view or continue working with. Pages merely visited, search results, and
intermediate steps do not need to remain open.

```js
await task.finish({ keep: [] }); // Default: keep no Agent-managed Pages.
await task.finish({ keep: ["p2"] }); // Exception: keep only the result Page for the user.
```

User-created and unmanaged tabs are protected; if any remain, `keep: []` does
not close the whole space. Do not close unwanted Pages one by one at completion;
list the Pages to keep instead.
Use `page.close()` only while the task is still in progress. Do not call
`finish()` when the task stops for user control or an error.

If the final output contains `[ego-browser:notice]`, finish the current browser
task, tell the user an Ego Lite update is available, and run
`ego-browser upgrade` only with their approval. Run `ego-browser skill` again
after the upgrade.
