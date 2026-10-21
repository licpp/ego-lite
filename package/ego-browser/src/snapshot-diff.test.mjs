import test from "node:test";
import assert from "node:assert/strict";
import {
  diffSnapshot,
  validateSnapshotBaseline,
} from "../dist/src/snapshot-diff.js";

test("diff includes current hierarchy context, counts removals and omits unchanged siblings", () => {
  const a = diffSnapshot(
    "root\n  group A\n    text old\n  group B\n    text stable",
    "viewport",
  );
  assert.match(a.body, /full: new/);
  assert.ok(!JSON.stringify(a.baseline).includes("stable"));
  const b = diffSnapshot(
    "root\n  group A\n    text new\n  group B\n    text stable",
    "viewport",
    a.baseline,
  );
  assert.match(b.body, /1 added\/changed lines; 1 previous lines/);
  assert.match(b.body, /root\n  group A\n    text new/);
  assert.doesNotMatch(b.body, /stable|text old|group B/);
  assert.match(
    diffSnapshot(
      "root\n  group A\n    text new\n  group B\n    text stable",
      "viewport",
      b.baseline,
    ).body,
    /no changes/,
  );
  assert.deepEqual(validateSnapshotBaseline(a.baseline), a.baseline);
});

test("navigation/scope reset, order changes, duplicate counts, ancestor changes, empty result and size limits", () => {
  const old = diffSnapshot("root\n  a\n  b\n  b", "one").baseline;
  assert.match(
    diffSnapshot("root\n  a\n  b\n  b", "two", old).body,
    /full: new/,
  );
  assert.match(
    diffSnapshot("root\n  b\n  a\n  b", "one", old).body,
    /order changed/,
  );
  assert.match(
    diffSnapshot("root\n  a\n  b", "one", old).body,
    /1 previous lines/,
  );
  assert.match(diffSnapshot("", "one", old).body, /4 previous lines/);
  const previous = diffSnapshot(
    "root\n  group old\n    text same",
    "one",
  ).baseline;
  assert.match(
    diffSnapshot("root\n  group new\n    text same", "one", previous).body,
    /2 added\/changed/,
  );
  const huge = diffSnapshot("row\n".repeat(20_001), "one");
  assert.equal(huge.baseline, undefined);
  assert.match(huge.body, /too many lines/);
  for (const value of [
    null,
    {},
    { key: "x", lines: [] },
    { key: old.key, lines: ["oops"] },
  ]) {
    assert.throws(
      () => validateSnapshotBaseline(value),
      /invalid snapshot baseline/,
    );
  }
});
