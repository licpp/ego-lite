import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readGuide } from "../dist/src/guide-runtime.js";
import { helperContext } from "../dist/src/helpers.js";

test("guide prints exactly one SDK-matched topic through the normal output sink", async () => {
  const printed = [];
  const helpers = helperContext(
    {},
    { printHelp: (text) => printed.push(text) },
  );
  for (const topic of ["scripts", "spaces", "pages", "files"]) {
    const source = await readFile(
      new URL(`../skill-body/references/${topic}.md`, import.meta.url),
      "utf8",
    );
    assert.equal(await helpers.guide(topic), source);
    assert.equal(printed.at(-1), source);
  }
  assert.equal(printed.length, 4);
  assert.match(await readGuide(), /Guide topics:/);
  for (const invalid of ["../SKILL", "all", "", null, 42]) {
    await assert.rejects(() => readGuide(invalid), /Unknown guide topic/);
  }
});
