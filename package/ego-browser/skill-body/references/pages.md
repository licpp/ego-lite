## Page operations

ego-browser provides the following Page API:

- State and observation: `label`, `spaceId`, `openedBy`, `targetId`, `url()`,
  `title()`, `info()`, `snapshot()`, `screenshot()`
- Navigation and waits: `goto()`, `reload()`, `waitForURL()`,
  `waitForEvent()`, `waitForSelector()`, `waitForLoadState()`,
  `waitForFunction()`, `waitForTimeout()`
- Elements: `click()`, `dblclick()`, `hover()`, `dragAndDrop()`, `fill()`,
  `selectOption()`, `focus()`, `press()`, `setInputFiles()`,
  `waitForFileChooser()`, `close()`
- Dialogs: `acceptDialog(promptText?)`, `dismissDialog()`
- Pointer: `mouse.click()`, `move()`, `down()`, `up()`, `wheel()`
- Keyboard: `keyboard.down()`, `up()`, `press()`, `type()`, `insertText()`,
  `paste()`
- Page code and protocols: `evaluate(fnOrString, argument)`,
  `fetch(url, options)`, `cdp(method, params, options)`

`page.evaluate()` callbacks run only inside the Page; they cannot read variables
or Node.js modules from the surrounding script. Define browser-side helpers
inside the callback or pass one JSON-serializable value as its second argument.

Work efficiently:

- Each time you observe, collect only the cheapest page state sufficient to
  choose the next action. Use a snapshot for semantic or locator ground truth
  and a screenshot for visual confirmation; do not request both by default.
- If an action does not produce the expected result, inspect the current page
  before deciding whether to retry. Do not blindly repeat it or immediately
  fall back to coordinates or raw CDP.
- Once the page clearly shows the requested result, stop; do not confirm the
  same result through multiple surfaces.

### Semantic pages: snapshot and selectors

Prefer snapshots and semantic selectors for ordinary DOM pages. Use screenshots
and coordinates only when useful DOM semantics are unavailable.

Before choosing an unfamiliar target, take a snapshot. When the current state
is sufficient to plan several actions on the same Page, complete them in one
script invocation, then observe the result once. Observe between actions only when an
intermediate result changes what should happen next. Keep the action sequence,
the wait for its final expected state, and the next snapshot in the same
script invocation. Print the snapshot last so the next round can act on it directly.
The final snapshot is the next round's starting view of the changed page;
without it, that round usually has to spend a separate browser call observing
before it can choose the next target, which wastes compute.

Wait for the expected result: use `waitForURL()` for navigation,
`waitForSelector()` for element state, or `waitForFunction()` for application
state. Avoid fixed delays when an observable condition exists. A snapshot
captures the current moment; it does not wait for the page to become stable.
`page.snapshot()` captures the current viewport. For content outside it, use
`page.snapshot({ scope: "full_page" })`.
Use `{ maxChars: 6000 }` to bound returned body text at complete lines (header and
omission notice are additional). `{ diff: true }` emits changes and ancestor
context since the last complete diff observation, across CLI rounds. First use,
navigation, scope/rendering-option changes and reordered content return full
output. Truncation never advances the baseline. Omit `diff` to clear the baseline.
Lines no longer observed may simply have scrolled out of view. Both options affect
returned text; native capture and ref validation still run.

The default viewport snapshot includes visible iframe content returned by the
browser. To focus on a frame's subtree, reuse the ref printed on its `iframe`
line:

```js
console.log(await page.snapshot({ scope: "subtree", root: "@12" }));
```

Use the refs returned by the subtree for actions inside the iframe. A subtree
snapshot does not scope later locator actions; they still prefer actionable
matches in the top document before searching frames.

`waitForLoadState()` defaults to `load`. `waitForFunction()` follows the
Playwright argument order; pass `undefined` before options when there is no Page
argument:

```js
await page.waitForFunction(() => window.appReady, undefined, {
  timeout: 10_000,
});
```

```js
// Round 1: inspect and choose targets from this output.
const page = task.page("p1");
console.log(await page.snapshot());
```

```js
// Next round: act using the previous output, verify, then prepare the next round.
const page = task.page("p1");
await page.fill("@21", "user@example.com");
await page.click("loc=role:button[name='Sign in']");
await page.waitForSelector("loc=css:#account-home", { state: "visible" });
console.log(await page.snapshot());
```

Element actions accept:

- snapshot refs such as `@21` or `ref=21`
- `text=...` for page content
- `loc=css:`, `loc=role:`, and `loc=href:` locators
- `xpath=...`
- raw CSS selectors

Selector actions require exactly one match. Unquoted text normalizes whitespace,
ignores case, and matches a substring; quoted text such as
`text="Save changes"` is exact and case-sensitive.

A small Playwright-compatible selector subset is also accepted: `css=...`,
terminal `:has-text("...")` and `:text-is("...")`, `>> nth=N` after a CSS,
text, or href selector (`N` is `-1` or non-negative), plus
`loc=role:...[name*="..."]` for accessible-name substrings. Other Playwright
selector syntax is not supported.

When a selector identifies a wrapper, `focus()` and `press()` may use its
interactive ancestor or unique editable descendant; `fill()` and
`setInputFiles()` only continue to a unique compatible control.

`click()`, `fill()`, `hover()`, and `dragAndDrop()` automatically bring their
target into view with browser wheel input. Do not pre-scroll solely to make a
DOM target actionable.

Snapshot node names are accessibility roles. Use a ref now or `loc=...` to find
the element again. After the page changes, take a new snapshot. When a useful
node has no ref, construct a selector from its role, text, or surrounding
context. CSS searches nested open shadow roots. Actions use an actionable match
in the top document first, then search frames when the top document has none.
Multiple actionable matches in the selected document or frame are ambiguous.

Select options by value, visible label, or zero-based index. A string matches
either value or label; pass an array for a multiple select:

```js
await page.selectOption("select[name=month]", { label: "October" });
```

Pass `null` or `[]` to clear the current selection.

### Visual pages: screenshot, mouse, and keyboard

Use a screenshot with mouse and keyboard operations for canvas, rich-text,
spreadsheets, maps, and other interfaces that lack useful DOM semantics:

```js
const path = await page.screenshot({ path: "/absolute/path/before.png" });
await page.mouse.click(420, 260, { label: "open spreadsheet cell" });
await page.mouse.wheel(0, 600, { label: "scroll project board" });
await page.keyboard.paste("hello\tworld");
console.log({ screenshot: path });
```

`path` must be absolute; relative paths are rejected. Omit `path` to write
into the system temporary directory and use the returned file path. On
Windows, write paths with forward slashes, such as
`C:/Users/<name>/ego-shots/before.png`, because backslashes are escape
characters inside JavaScript strings.

Inspect the screenshot with an image-viewing tool. Coordinates use CSS pixels;
keyboard names and `+`-separated chords follow Playwright syntax. Use
`ControlOrMeta` for portable shortcuts and verify the resulting page state.
`mouse.wheel()` performs a short wheel-input motion at the current mouse
position and resolves when that motion completes. In each script invocation, move or
click over the intended scrollable area before using it.

On macOS and Windows, `keyboard.paste()` sends the native paste shortcut and
then restores the user's clipboard. Pass `{ text, html }` when a rich editor
needs structured clipboard content; `text` is the plain-text fallback. On other
platforms, use `keyboard.insertText()` for plain text.

```js
await page.keyboard.paste({
  text: "Name\tStatus",
  html: "<table><tr><td>Name</td><td>Status</td></tr></table>",
});
```

For rich-text editors and editable grids, validate a small edit before repeating
it at scale. Canvas-backed editors may not expose visible content through DOM
text or selectors; verify those results with a screenshot or an
application-specific visible state.

### Page JavaScript and CDP

Use `page.evaluate()` for bulk extraction or complex in-page work. It accepts
one JSON-serializable argument and returns a JSON-serializable value:

```js
const rows = await page.evaluate(
  ({ selector, limit }) =>
    [...document.querySelectorAll(selector)].slice(0, limit).map((node) => ({
      text: node.textContent?.trim(),
      href: node.querySelector("a")?.href,
    })),
  { selector: "article", limit: 20 },
);
```

`page.evaluate()` has no timeout option. Keep long work in bounded calls; on a
safety timeout, use `executionStopped` and `mayHaveLateEffects` to decide
whether an unsafe follow-up requires reloading or closing the Page first.

Use documented Page methods first. If a wrapper is missing or does not work
reliably on the current page, use `page.cdp()` as a lower-level path for
diagnosis or control. It accepts Page, Runtime, DOM, Network, Input, and similar
commands; use `task.cdp()` for Target and Browser commands. Raw CDP invalidates
refs. Do not persist `page.targetId` across rounds.
