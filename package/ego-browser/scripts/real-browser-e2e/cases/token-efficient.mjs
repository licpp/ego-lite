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

export function localSnapshotPrepareCase() {
  return String.raw`
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    try {
      await page.evaluate(() => {
        document.body.innerHTML = '<button id="act">算法申请 云南</button><output></output><main></main>';
        document.querySelector('#act').onclick = () => document.querySelector('output').textContent = 'Verified action';
        for (let i = 0; i < 150; i++) {
          const p = document.createElement('p');
          p.textContent = '岗位 ' + i + ' 四川 算法 ' + '详情 '.repeat(10);
          document.querySelector('main').append(p);
        }
      });
      const path = join(tempDir, 'local-snapshot.txt');
      const saved = await page.saveSnapshot({ path, scope: 'full_page' });
      assertEqual(saved.path, path, 'save returns the absolute file path');
      assertEqual(saved.scope, 'full_page', 'save records scope');
      assertEqual(saved.url, baseUrl + '/nav-target', 'save records source URL');
      assert(!JSON.stringify(saved).includes('详情'), 'save returns metadata without page body');
      const raw = await readFile(path, 'utf8');
      assertIncludes(raw, '岗位 149', 'full snapshot captures offscreen loaded text');
      assert(saved.bytes > 5000, 'fixture produces a long snapshot');
      await assertRejects(() => page.saveSnapshot({ path }), 'EEXIST', 'existing snapshot is never overwritten');
      assertEqual(await readFile(path, 'utf8'), raw, 'failed overwrite leaves original snapshot intact');
      const result = await searchSnapshot(path, ['四川', '云南'], { maxMatches: 3, contextLines: 0, maxChars: 1000 });
      assertEqual(result.totalMatches, 151, 'search counts all matching lines');
      assertEqual(result.returnedMatches, 3, 'search limits selected matches');
      assert(result.truncated, 'search reports omitted results');
      assert(result.text.length <= 1000, 'search obeys a total snippet character budget');
      const refreshed = await page.snapshot({ maxChars: 1000 });
      assertIncludes(refreshed, '云南', 'current snapshot can refresh saved refs');
      const actionLine = refreshed.split('\n').find((line) => /^\s*button.*\[ref=/.test(line));
      const actionRef = actionLine && actionLine.match(/\[ref=(\d+)/);
      assert(actionRef, 'fresh observation publishes a current action ref');
      await page.click('@' + actionRef[1]);
      assertEqual(await page.evaluate(() => document.querySelector('output').textContent), 'Verified action', 'current page remains actionable');
      await writeFile(join(tempDir, 'local-snapshot-meta.json'), JSON.stringify(saved));
    } finally { await page.close(); }
  `;
}

export function localSnapshotResumeCase() {
  return String.raw`
    const saved = JSON.parse(await readFile(join(tempDir, 'local-snapshot-meta.json'), 'utf8'));
    const result = await searchSnapshot(saved.path, '岗位 149', { contextLines: 0, maxChars: 300 });
    assertEqual(result.totalMatches, 1, 'saved snapshot is searchable in a new CLI round after Page close');
    assertIncludes(result.text, '岗位 149', 'local search returns a targeted snippet');
    assertEqual(result.source.page, saved.page, 'source Page label is retained');
    assertEqual(result.source.capturedAt, saved.capturedAt, 'capture time is retained');
    const physical = (await readFile(saved.path, 'utf8')).split('\n');
    assertIncludes(physical[result.matchLines[0] - 1], '岗位 149', 'line numbers match physical rg lines');
    assertIncludes(result.notice, 'not live', 'search states saved content is not live');
    assertEqual((await searchSnapshot(saved.path, 'no such job')).totalMatches, 0, 'no-match search is concise');
    await (await import("node:fs/promises")).rm(saved.path);
  `;
}
