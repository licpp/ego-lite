import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installLocalSdk,
  uninstallLocalSdk,
} from "../scripts/install-local-sdk.mjs";

test("local installation preserves and restores a debug SDK and a user Skill symlink", async () => {
  const home = await mkdtemp(join(tmpdir(), "ego-overlay-test-"));
  try {
    const debug = join(home, "Library/Application Support/Citro Labs/debug");
    const skill = join(home, ".agents/skills/ego-browser");
    const original = join(home, "original-skill");
    await mkdir(debug, { recursive: true });
    await mkdir(join(home, ".agents/skills"), { recursive: true });
    await mkdir(original);
    await writeFile(join(debug, "index.js"), "original SDK");
    await writeFile(join(original, "SKILL.md"), "original Skill");
    await symlink(original, skill, "dir");
    await assert.rejects(
      () => installLocalSdk({ home, payload: join(home, "missing") }),
      /ENOENT/,
    );
    assert.equal(
      await readFile(join(debug, "index.js"), "utf8"),
      "original SDK",
    );
    const result = await installLocalSdk({ home });
    assert.equal(result.backups.length, 2);
    assert.match(
      await readFile(join(debug, "ego-browser/SKILL.md"), "utf8"),
      /maxChars/,
    );
    assert.equal((await lstat(skill)).isSymbolicLink(), false);
    assert.equal(
      await readFile(join(original, "SKILL.md"), "utf8"),
      "original Skill",
    );
    await assert.rejects(() => installLocalSdk({ home }), /already installed/);
    await writeFile(join(skill, "user-note.txt"), "keep my later edit");
    const restored = await uninstallLocalSdk({ home });
    assert.equal(restored.preserved.length, 2);
    assert.equal(
      await readFile(join(debug, "index.js"), "utf8"),
      "original SDK",
    );
    assert.equal((await lstat(skill)).isSymbolicLink(), true);
    assert.equal(
      await readFile(join(restored.preserved[1], "user-note.txt"), "utf8"),
      "keep my later edit",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("uninstall refuses a foreign destination before modifying either directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "ego-overlay-guard-"));
  try {
    const result = await installLocalSdk({ home });
    await writeFile(
      join(result.skill, ".token-efficient-overlay.json"),
      JSON.stringify({ owner: "someone else" }),
    );
    await assert.rejects(
      () => uninstallLocalSdk({ home }),
      /refusing to overwrite/,
    );
    assert.match(await readFile(result.sdk, "utf8"), /installEgoSdk/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
