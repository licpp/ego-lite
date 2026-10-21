## Run browser scripts

Pass the script to `ego-browser nodejs`. The form depends on the shell that runs
the command: heredoc is Bash/Zsh syntax and does not exist in PowerShell or cmd.

### Bash, Zsh, Git Bash

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("inspect example page");
const page = task.page("p1");
await page.goto("https://example.com");

console.log({ taskSpaceId: task.spaceId, page: page.label });
console.log(await page.snapshot());
EOF
```

When a sandbox blocks heredoc input, use `-e` instead. Use single quotes around
the code and double quotes for JavaScript strings; single quotes within the code
require shell quoting.

```bash
ego-browser nodejs -e '
const task = await taskSpace("inspect example page");
await task.page("p1").goto("https://example.com");
console.log(task.spaceId);
'
```

### PowerShell

PowerShell has no heredoc, and Windows PowerShell 5.1 drops the double quotes
inside an argument when it calls a native program, which splits the script into
several arguments. Do not pass a script that contains double quotes or spans
several lines to `-e`. Write it to a UTF-8 `.mjs` file instead and evaluate an
ASCII-only one-line entry point, which needs no double quotes of its own:

```powershell
ego-browser nodejs -e "await import('file:///C:/Users/<name>/ego/task.mjs')"
```

The imported module runs with the same helpers and `console` as an inline
script, so the whole task belongs in the `.mjs` file. Use forward slashes in the
`file:///` URL. Non-ASCII content such as Chinese text must stay inside the
file: never put it in a `-e` argument.

Do not pipe the file in with `Get-Content`. Windows PowerShell 5.1 reads a UTF-8
file as ANSI and sends ASCII to native programs, which corrupts non-ASCII text
and truncates strings. PowerShell has no `<` input redirection either.

### cmd

cmd has no heredoc, but it does support input redirection, so it can run the
same `.mjs` file directly:

```bat
ego-browser nodejs < C:\Users\<name>\ego\task.mjs
```

### Reuse helpers; keep executed entrypoints immutable

Each invocation is a new process. Browser state persists, JavaScript variables do
not. A new file per round is optional on Bash/Zsh; small heredocs are sufficient.
When files are useful (especially on Windows), keep an executed entrypoint
unchanged so rerunning it cannot silently replay earlier mutations. You may edit
an entrypoint that has not run yet.

Write shared, task-local functions once, then import them from short round files.
Do not copy every previous action into the next round. For example:

```js
// helpers.mjs: write and inspect this once for the current task.
export async function addAward(page, award) {
  await page.fill("#awardName", award.name);
  await page.fill("#authority", award.authority);
  await page.click('button:text-is("Save")');
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll(".award-row")].some((row) =>
        row.textContent.includes(name),
      ),
    award.name,
  );
}
```

```js
// round-02.mjs: only the next action, not the whole task history.
const { addAward } = await import("file:///absolute/task/helpers.mjs");
const task = await taskSpace(7);
await addAward(task.page("p1"), {
  name: "Verified award",
  authority: "Issuing institution",
});
console.log({ saved: "Verified award" });
```

Selectors above are examples: inspect the actual form before implementing its
helper. A save wait must observe a **new** record or changed value, not a row that
already existed before the click. Keep helpers site-shaped; do not automatically
retry a submission. Only run task scripts written or inspected in the current
conversation. A helper import is not an exemption from ownership or user-control
checks. Do not store credentials or personal application data in reusable helpers.

The entry Skill also ships `scripts/form-helpers.mjs`: import it by absolute file
URL for `fillFields(page, fields)` and `saveAndVerify(page, { save, verify, arg,
timeout? })`. `verify` must start false and become true only after a new saved
result appears. These helpers propagate errors, including user-control hard stops.

Keep the task's files in one directory. On PowerShell 5.1 create UTF-8 files with
your file tool, not `Set-Content`, `Out-File`, or `>` (which can write ANSI/UTF-16).

### When the script fails to parse

`SyntaxError: await is only valid in async functions and the top level bodies of
modules` almost always means the shell damaged the script before Node received
it; top-level `await` itself is supported. Do not wrap the code in an async
IIFE, open a new task space, or resend the same command. Switch to the `.mjs`
file form above.

The script always runs in Node.js, not in the web Page. Browser helpers and
Node.js APIs belong in the script; Page globals such as `window`, `document`,
`location`, and DOM APIs do not. Put browser-side JavaScript inside
`page.evaluate()`. Do not import Playwright or launch another browser.

The Node.js runtime uses ESM. When a script needs local files, load built-ins
with dynamic imports such as `await import("node:fs/promises")`. The script
does not run in your shell's working directory, so use absolute paths for every
file it reads or writes. It also does not inherit your shell's environment
variables: `process.env` will not contain values you set before running
`ego-browser`, so write every input directly into the script.

Ego-browser deliberately exposes a small custom API. It is not Playwright, even
where method names and options look similar. Use only the TaskSpace, Page,
FileChooser, mouse, and keyboard APIs explicitly listed in this Skill. Do not
infer Playwright methods such as `locator()`, `getByRole()`, `context()`,
`expect()`, or `route()`. When the listed API does not cover an operation, use
the documented `page.evaluate()` or `page.cdp()` escape hatches instead of
guessing another method.

Only these pointer actions accept an optional `label` option: `click()`,
`dblclick()`, `hover()`, `dragAndDrop()`, `mouse.click()`, `mouse.move()`, and
`mouse.wheel()`. Pass a concise 3-6 word description to keep the action text
next to the visible agent cursor in sync with the action. Other methods, such
as `fill()`, `press()`, `focus()`, `selectOption()`, `waitForSelector()`,
`keyboard.*()`, `mouse.down()`, and `mouse.up()`, reject a `label` option.
The `label` in `selectOption(selector, { label })` is different: it selects the
option whose visible text matches.

When the user explicitly asks for ego-browser, start with a real browser command
and diagnose the CLI or installation only if it fails.
