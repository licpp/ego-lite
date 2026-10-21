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
