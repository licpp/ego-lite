import test from "node:test";
import assert from "node:assert/strict";
import { limitSnapshotBody } from "../dist/src/snapshot-budget.js";

test("small/unbudgeted snapshots are byte-identical; large ones omit whole lines explicitly", () => {
  const text = 'root\n  button [ref=21] "Save"\n  textbox [ref=22] "Name"';
  assert.equal(limitSnapshotBody(text), text);
  assert.equal(limitSnapshotBody(text, text.length), text);
  const limited = limitSnapshotBody(text, 30);
  assert.match(
    limited,
    /^root\n  button \[ref=21\] "Save"\n\[ego-browser:snapshot\] truncated:/,
  );
  assert.doesNotMatch(limited, /ref=22/);
  assert.match(
    limitSnapshotBody("a".repeat(100), 3),
    /^\[ego-browser:snapshot\] truncated: 0\/100/,
  );
  assert.doesNotMatch(limitSnapshotBody("🙂\n".repeat(10), 4), /\ud83d\n/);
});
