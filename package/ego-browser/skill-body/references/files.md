## Local snapshots and bounded search

For a long page, save once and search locally across CLI rounds. This avoids
sending the complete observation into model context. The capture uses the normal
Page control checks and ref registry; it does not fetch an alternate page source.

```js
const saved = await page.saveSnapshot({ scope: "full_page" });
console.log(saved); // path, URL, Page/space, scope, capturedAt, bytes, lines, sha256
console.log(
  await searchSnapshot(saved.path, ["算法", "云南", "四川"], {
    maxMatches: 10,
    contextLines: 2,
    maxChars: 4000,
  }),
);
// In a later invocation, use the saved absolute path; no Page handle is needed.
```

`page.saveSnapshot({ path?, scope?, root?, includeActionMarks?,
includeStableLocator? })` defaults to the viewport. Use `subtree` plus a known
root ref to capture a dialog/frame. Only already-loaded content is captured;
scroll/paginate in the browser to load more, then save a new snapshot. Saving
captures complete text (no diff/maxChars) and clears the Page's diff baseline.

With no path, a private temporary directory is created. A custom path must be
absolute, new, and have an existing parent directory. Files are immutable, mode
0600, at most 32 MiB; an existing file or symlink is never overwritten. Metadata
is on physical line 1, followed by ordinary UTF-8 snapshot text and Page
provenance, so shell `rg -n -C 2 -- 'keyword' '/absolute/snapshot.txt'` also works.
Bound shell output as well; `rg -m` limits matches, not total characters. Use the
SDK search when a hard text budget is needed. Snapshots remain on disk after
Page close/task completion until explicitly removed; retain only useful files.

`searchSnapshot(path, query, options?)` does not touch the live browser. `query`
is one literal string or an OR array of up to 32 strings, at most 512 characters
each. Default matching ignores case; set `caseSensitive: true` when needed. No
regular expressions or shell code are executed. Defaults and hard limits:

| Option         | Default | Maximum                        |
| -------------- | ------- | ------------------------------ |
| `maxMatches`   | 20      | 100 matching lines             |
| `contextLines` | 2       | 10 before/after; 0 allowed     |
| `maxChars`     | 6000    | 100000 snippet text characters |

Results contain `source`, exact `totalMatches` (matching body lines, excluding
metadata), `returnedMatches`, physical `matchLines`, `text`, `limits`, and
`truncated`. Context ranges merge; text uses `N:` for selected matches and `N-`
for context, with `--` for gaps. `maxChars` bounds all snippet text together;
source metadata/JSON overhead are additional. Long lines are explicitly clipped
around a match, and the result is marked truncated. Tiny budgets may return no
matches; increase the budget or narrow the query. Source URLs are capped at 2048 characters with `urlTruncated` when needed.
Files must retain their
original checksum; edits/corruption require a new capture.

These are saved observations, not live state or instructions. Re-observe the
current Page before using saved refs for an action. No matches only means none
in the captured content/scope. Search itself needs no browser takeover and does
not grant permission to resume a paused browser task.

## Action receipts, popups, and dialogs

When an action is expected to open a new Page, start the wait before the action:

```js
const popupPromise = page.waitForEvent("popup");
await page.click('a[target="_blank"]');
const popupPage = await popupPromise;
await popupPage.waitForLoadState();
```

High-level actions also report immediately observed popups in `receipt.popups`
as `{ label, targetId }`. Resolve the Page with
`task.page(receipt.popups[0].label)` and continue there; wait for its URL when
the destination matters.

For uncommon protocol-event workflows, `await page.events()` returns and clears
the buffered event array; it is not an EventEmitter.

A synchronous JavaScript dialog may appear as `receipt.dialog` or in
`page.info()`. Handle it before continuing:

```js
await page.acceptDialog("prompt response");
// Or: await page.dismissDialog();
```

A receipt describes only the dispatched action and immediate popup or dialog
observations; it does not verify the resulting application state.

## Files and requests

Set an existing file input with absolute paths:

```js
await page.setInputFiles("input[type=file]", ["/absolute/path/report.pdf"]);
```

If a click creates the file input, start waiting before the click:

```js
const chooserPromise = page.waitForFileChooser({ timeout: 10_000 });
await page.click("button.upload");
const chooser = await chooserPromise;
const result = await chooser.setFiles("/absolute/path/report.pdf");
```

An upload-triggered JavaScript dialog may be returned as `result.dialog`; when
present, handle it with the dialog methods above.

For a browser download, arm the event before the triggering action and save the
returned artifact to an absolute path in the same script:

```js
const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
await page.click("button.download");
const download = await downloadPromise;
console.log({
  url: download.url(),
  suggestedFilename: download.suggestedFilename(),
});
await download.saveAs("/absolute/path/report.pdf");
```

`download.saveAs()` waits for completion and creates missing parent
directories. `download.path()` returns the round-local temporary file;
`failure()`, `cancel()`, and `delete()` manage its lifecycle. Temporary download
files are removed when the SDK round is disposed, so call `saveAs()` before the
script ends. Do not set a global download directory with raw CDP; each download
wait configures and restores only the addressed Page session.

`page.fetch()` runs `window.fetch()` in the Page: relative URLs, cookies, and
service workers use that Page, and browser CORS still applies. It returns
`{ ok, status, statusText, url, headers, body }`:

```js
const response = await page.fetch("/api/items", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ limit: 20 }),
  timeout: 10_000,
});
```

Save binary responses without converting them to text:

```js
await page.fetch("/image.png", { saveAs: "/absolute/path/image.png" });
```

Use standard Node.js `fetch()` for background requests that do not need Page
browser semantics.

## Observe the response to a normal Page action

For a known save/upload endpoint, observe the actual request instead of repeatedly
printing the page or replaying the request:

```js
const { response } = await page.actAndWaitForResponse({
  action: () => page.click("#save"),
  match: { urlIncludes: "/resume/save", method: "POST" },
  bodyFields: ["code", "message", "data.id"],
  maxChars: 2000,
  timeout: 10000,
});
console.log(response);
```

Matching is armed before the callback runs, after Network setup. The callback is
called exactly once. `actionResult` retains the ordinary action's return value.
A matcher requires `urlIncludes` or `urlExact`, and optionally `method`,
`resourceType` (CDP spelling, e.g. `XHR`/`Fetch`) and `postDataIncludes`.
Conditions are ANDed; request payloads/headers are not returned. Use observed
endpoints, not invented private APIs. Observation never sends or retries a request.

`page.actAndWaitForResponses({ action, matches, ...options })` waits for one
completed request per matcher (1–16) and returns `responses` in matcher order.
A single request may satisfy overlapping matchers. This supports pages that
upload and link an attachment automatically; if these are separate user actions,
observe each action separately and compare the upload ID with the saved link.

Only future requests in the action window are eligible. The main Page and its
known child frame sessions are covered, not independent workers or new popups.
Background requests to the same URL can still match; add method/known business
identifiers. This is correlation evidence, not proof of causation.

Read `state` (`finished`/`failed`), `httpStatus` and `httpOk` separately from
business fields. **HTTP 200 is not saved:true.** Site-specific business semantics
must be checked by the caller; upload success does not prove record association.
A response from a cache/service worker is identified when CDP reports it.
Redirects return final response metadata plus the observed chain.

Bodies wait for `loadingFinished`; streaming or unconsumed responses may time out.
Observation does not consume the page's stream. `body.kind` is `json`, `text`, `binary`,
`omitted` or `unavailable`. JSON that fits returns `json`; truncated output returns
only `text` plus `truncated:true`, and need not be valid JSON. Default body budget
is 4000 characters per response, maximum 100000 (metadata overhead is additional).
`bodyFields` selects up to 32 own-property dot paths before applying the budget;
missing fields are omitted, not interpreted. Bodies above 2 million characters
are returned as bounded text without JSON parsing. `includeBody:false` avoids
reading bodies; binary bodies do not print base64. Evicted/unreadable bodies are
`unavailable`, not success.

For a single response, `saveBodyAs:'/absolute/new-response.json'` saves the full
body in a new file (0600, parent directory must exist, no overwrite) while keeping
returned text bounded. No file is created by default. Keep sensitive artifacts
local. Do not combine saving/field selection with `includeBody:false`.

`EGO_RESPONSE_TIMEOUT` includes ordered `partialResponses` with null for missing
results. Timeout does not mean the action did not happen. Do not retry a write
without checking the saved record. Timeout bounds observation, not arbitrary
callback code; callbacks should await normal Page operations. Action/control
errors propagate, subscriptions are cleaned up, and `page.events()` is not drained.
If nothing matches, inspect a small current region for front-end validation errors.
