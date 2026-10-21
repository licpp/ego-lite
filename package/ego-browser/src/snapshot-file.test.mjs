import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeSnapshotFile,
  searchSnapshot,
} from "../dist/src/snapshot-file.js";
import { helperContext } from "../dist/src/helpers.js";

const source = {
  url: "https://example.test/jobs",
  page: "p1",
  spaceId: 7,
  scope: "full_page",
};
async function withFile(body, fn) {
  const dir = await mkdtemp(join(tmpdir(), "ego-snapshot-file-test-"));
  try {
    const saved = await writeSnapshotFile(
      body,
      source,
      join(dir, "snapshot.txt"),
    );
    await fn(saved, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("snapshots are immutable private grep-friendly text files; API returns metadata only", async () => {
  await withFile(
    '[p1 source]\nroot\n  button "AI 云南" [ref=21]',
    async (saved) => {
      assert.equal(saved.lines, 4);
      const text = await readFile(saved.path, "utf8");
      assert.equal(Buffer.byteLength(text), saved.bytes);
      assert.match(text, /\nroot\n  button "AI 云南" \[ref=21\]\n$/);
      assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
      assert.equal(saved.url, source.url);
      assert.ok(!JSON.stringify(saved).includes("AI 云南"));
      await assert.rejects(
        () => writeSnapshotFile("overwrite", source, saved.path),
        { code: "EEXIST" },
      );
      assert.equal(await readFile(saved.path, "utf8"), text);
      assert.equal(helperContext().searchSnapshot, searchSnapshot);
    },
  );
  const automatic = await writeSnapshotFile("root", source);
  try {
    assert.match(automatic.path, /ego-browser-snapshot-/);
    assert.equal(
      (await searchSnapshot(automatic.path, "root")).totalMatches,
      1,
    );
  } finally {
    await rm(join(automatic.path, ".."), { recursive: true, force: true });
  }
});

test("search counts all matching lines, merges context, reports physical rg line numbers and literal OR terms", async () => {
  await withFile(
    "root\n云南 AI\n四川 推荐\nGuangzhou\nlast",
    async ({ path }) => {
      const result = await searchSnapshot(path, ["云南", "四川"], {
        contextLines: 1,
      });
      assert.equal(result.totalMatches, 2);
      assert.equal(result.returnedMatches, 2);
      assert.deepEqual(result.matchLines, [3, 4]);
      assert.equal(result.truncated, false);
      assert.equal(
        result.text,
        "2- root\n3: 云南 AI\n4: 四川 推荐\n5- Guangzhou\n",
      );
      assert.equal(result.source.url, source.url);
      assert.match(result.notice, /not live/);
      assert.equal((await searchSnapshot(path, "guangzhou")).totalMatches, 1);
      assert.equal(
        (await searchSnapshot(path, "guangzhou", { caseSensitive: true }))
          .totalMatches,
        0,
      );
      assert.equal((await searchSnapshot(path, ".*")).text, "");
      assert.equal(
        (await searchSnapshot(path, "$(touch /tmp/not-executed)")).totalMatches,
        0,
      );
    },
  );
});

test("match and total snippet character limits hold, including tiny budgets and long Unicode lines", async () => {
  await withFile("root\n" + "AI job\n".repeat(1000), async ({ path }) => {
    const result = await searchSnapshot(path, "AI", {
      maxMatches: 2,
      contextLines: 2,
    });
    assert.equal(result.totalMatches, 1000);
    assert.equal(result.returnedMatches, 2);
    assert.equal(result.truncated, true);
    assert.equal((result.text.match(/AI job/g) || []).length, 2);
  });
  await withFile(
    "root\n" + "🙂".repeat(4000) + "云南" + "🙂".repeat(4000),
    async ({ path }) => {
      for (const maxChars of [1, 5, 7, 8, 9, 10, 20, 100]) {
        const result = await searchSnapshot(path, "云南", {
          contextLines: 0,
          maxChars,
        });
        assert.ok(
          result.text.length <= maxChars,
          `${maxChars}: ${result.text.length}`,
        );
        assert.equal(result.truncated, true);
        assert.equal(result.text.isWellFormed(), true);
        if (maxChars === 100) assert.match(result.text, /云南/);
      }
    },
  );
  await withFile("first hit\nignore\nignore\nlast hit", async ({ path }) => {
    assert.match(
      (await searchSnapshot(path, "hit", { contextLines: 0 })).text,
      /--\n/,
    );
    const clipped = await searchSnapshot(path, "hit", {
      maxChars: 12,
      contextLines: 0,
    });
    assert.ok(clipped.text.length <= 12);
    assert.equal(clipped.truncated, true);
  });
});

test("invalid inputs, edited snapshots and oversized files fail without unbounded output", async () => {
  await withFile("root", async ({ path }, dir) => {
    for (const options of [
      { maxMatches: 0 },
      { maxMatches: 101 },
      { contextLines: -1 },
      { contextLines: 1.5 },
      { contextLines: 11 },
      { maxChars: 0 },
      { maxChars: 100001 },
      { caseSensitive: "true" },
      { regex: true },
    ]) {
      await assert.rejects(
        () => searchSnapshot(path, "root", options),
        /must|limit|unknown option/,
      );
    }
    for (const query of [
      null,
      [],
      [""],
      "",
      "a\nb",
      "x".repeat(513),
      Array(33).fill("x"),
    ]) {
      await assert.rejects(() => searchSnapshot(path, query), /query must/);
    }
    await assert.rejects(
      () => searchSnapshot("relative.txt", "root"),
      /absolute/,
    );
    await assert.rejects(
      () => writeSnapshotFile("root", source, "relative.txt"),
      /absolute/,
    );
    await assert.rejects(
      () =>
        writeSnapshotFile(
          "x".repeat(32 * 1024 * 1024),
          source,
          join(dir, "big.txt"),
        ),
      /32 MiB/,
    );
    assert.equal((await searchSnapshot(path, "root")).totalMatches, 1);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(/root\n$/, "changed\n"),
    );
    await assert.rejects(
      () => searchSnapshot(path, "changed"),
      /content changed/,
    );
    await writeFile(path, "ordinary text");
    await assert.rejects(
      () => searchSnapshot(path, "ordinary"),
      /not an ego-browser/,
    );
    await writeFile(path, "[ego-browser:snapshot-file] null\nroot");
    await assert.rejects(
      () => searchSnapshot(path, "root"),
      /invalid snapshot file metadata/,
    );
    await writeFile(path, "x".repeat(32 * 1024 * 1024 + 1));
    await assert.rejects(
      () => searchSnapshot(path, "root"),
      /no larger than 32 MiB/,
    );
  });
});

test("source summaries stay bounded and unknown metadata is not echoed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ego-snapshot-source-test-"));
  try {
    const saved = await writeSnapshotFile(
      "root",
      { ...source, url: "https://example.test/" + "x".repeat(10000) },
      join(dir, "page.txt"),
    );
    assert.equal(saved.url.length, 2048);
    assert.equal(saved.urlTruncated, true);
    const data = await readFile(saved.path, "utf8");
    const boundary = data.indexOf("\n");
    const prefix = "[ego-browser:snapshot-file] ";
    const header = JSON.parse(data.slice(prefix.length, boundary));
    header.unknown = "not for model output";
    await writeFile(
      saved.path,
      prefix + JSON.stringify(header) + data.slice(boundary),
    );
    const result = await searchSnapshot(saved.path, "root");
    assert.equal(result.source.urlTruncated, true);
    assert.equal("unknown" in result.source, false);
    assert.ok(JSON.stringify(result).length < 4000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
