const helpersUrl = new URL(
  "../../../../../skills/ego-browser/scripts/form-helpers.mjs",
  import.meta.url,
).href;

export function tokenEfficientCase() {
  return `
    const { fillFields, saveAndVerify } = await import(${JSON.stringify(helpersUrl)});
    const topics = await guide();
    assertIncludes(topics, 'scripts', 'the SDK exposes the on-demand guide');
    await assertRejects(() => guide('../outside'), 'Unknown guide topic', 'guide does not accept paths');
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    try {
      await page.evaluate(() => {
        document.body.innerHTML = '<input id="award" aria-label="Award name"><button id="save">Save award</button><output id="saved"></output><main id="rows"></main>';
        document.querySelector('#save').onclick = () => {
          document.querySelector('#saved').textContent = document.querySelector('#award').value;
        };
        for (let i = 0; i < 200; i++) {
          const p = document.createElement('p');
          p.textContent = 'Large list row ' + i + ' ' + 'details '.repeat(10);
          document.querySelector('#rows').append(p);
        }
      });
      const full = await page.snapshot({ scope: 'full_page' });
      const bounded = await page.snapshot({ scope: 'full_page', maxChars: 500 });
      assertIncludes(bounded, '[ego-browser:snapshot] truncated:', 'large snapshot marks omissions');
      assert(bounded.startsWith('[p'), 'bounded snapshot keeps Page provenance');
      assert(bounded.length < full.length / 4, 'bounded snapshot materially reduces returned text');
      const saveLine = bounded.split('\\n').find((line) => /^\\s*button.*\\[ref=/.test(line));
      const saveRef = saveLine && saveLine.match(/\\[ref=(\\d+)/);
      assert(saveRef, 'bounded output preserves a complete actionable ref: ' + bounded);
      assertEqual((await fillFields(page, [{ selector: '#award', value: 'New verified award' }])).filled, 1, 'shared module fills fields');
      const verify = (name) => document.querySelector('#saved').textContent === name;
      const result = await saveAndVerify(page, { save: '@' + saveRef[1], verify, arg: 'New verified award' });
      assertEqual(result.saved, true, 'shared module verifies a new saved value');
      await assertRejects(() => saveAndVerify(page, { save: '#save', verify, arg: 'New verified award' }), 'already matches', 'pre-existing confirmation blocks a repeated save');
    } finally { await page.close(); }
  `;
}

export function snapshotDiffPrepareCase() {
  return String.raw`
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    await page.evaluate(() => {
      document.body.innerHTML = '<button id="change">Change</button><output id="result">Before</output><main id="stable"></main>';
      document.querySelector('#change').onclick = () => document.querySelector('#result').textContent = 'After';
      for (let i = 0; i < 100; i++) {
        const p = document.createElement('p');
        p.textContent = 'Stable unchanged row ' + i;
        document.querySelector('#stable').append(p);
      }
    });
    const full = await page.snapshot({ scope: 'full_page', diff: true });
    assertIncludes(full, 'full: new diff baseline', 'first diff is full');
    assertIncludes(full, 'Stable unchanged row 99', 'full-page snapshot observes offscreen rows');
    await writeFile(join(tempDir, 'snapshot-diff.json'), JSON.stringify({ label: page.label, fullLength: full.length }));
  `;
}

export function snapshotDiffResumeCase() {
  return String.raw`
    const saved = JSON.parse(await readFile(join(tempDir, 'snapshot-diff.json'), 'utf8'));
    const task = await taskSpace(taskName);
    const page = task.page(saved.label);
    try {
      assertIncludes(await page.snapshot({ scope: 'full_page', diff: true }), 'no changes', 'diff baseline survives a new CLI process');
      await page.click('#change');
      const clipped = await page.snapshot({ scope: 'full_page', diff: true, maxChars: 10 });
      assertIncludes(clipped, 'truncated:', 'tiny budget reports truncation');
      const delta = await page.snapshot({ scope: 'full_page', diff: true });
      assertIncludes(delta, 'After', 'unreported change is retained after truncation');
      assert(!delta.includes('Stable unchanged row'), 'delta omits unchanged rows');
      assert(delta.length < saved.fullLength / 2, 'delta materially reduces returned text');
      assertIncludes(await page.snapshot({ scope: 'full_page', diff: true }), 'no changes', 'complete delta advances baseline');
      await page.evaluate(() => {
        const replacement = document.createElement('button');
        replacement.textContent = 'Replacement action';
        replacement.onclick = () => document.querySelector('#result').textContent = 'Replacement clicked';
        document.querySelector('#change').replaceWith(replacement);
      });
      const replacementDelta = await page.snapshot({ scope: 'full_page', diff: true });
      assertIncludes(replacementDelta, 'Replacement action', 'replacement node is visible in delta');
      const refLine = replacementDelta.split('\n').find((line) => /^\s*button.*\[ref=/.test(line));
      const ref = refLine && refLine.match(/\[ref=(\d+)/);
      assert(ref, 'replacement delta publishes a current button ref');
      await page.click('@' + ref[1]);
      assertEqual(await page.evaluate(() => document.querySelector('#result').textContent), 'Replacement clicked', 'delta ref acts on the replacement node');
      const viewport = await page.snapshot({ diff: true });
      assertIncludes(viewport, 'full: new diff baseline', 'scope change starts a full baseline');
      assert(!viewport.includes('Stable unchanged row 99'), 'default viewport omits offscreen rows');
      await page.goto(baseUrl + '/nav-target?new-document');
      assertIncludes(await page.snapshot({ diff: true }), 'full: new diff baseline', 'navigation starts a full baseline');
    } finally { await page.close(); }
  `;
}
