#!/usr/bin/env node
// Installs a coherent SDK/guide overlay, preserving the app and browser profile.
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owner = "ego-lite-token-efficient";
const payloadRoot = fileURLToPath(new URL("../dist/out/", import.meta.url));

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function paths(home) {
  return {
    debug: join(home, "Library/Application Support/Citro Labs/debug"),
    skill: join(home, ".agents/skills/ego-browser"),
    state: join(home, ".local/state/ego-browser-token-efficient/install.json"),
  };
}

export async function installLocalSdk({
  home = homedir(),
  payload = payloadRoot,
} = {}) {
  const p = paths(home);
  if (await exists(p.state))
    throw new Error(
      "Overlay already installed; run npm run uninstall:local before replacing it.",
    );
  // Validate the whole payload before moving anything in the user's installation.
  for (const entry of [
    "index.js",
    "ego-browser/SKILL.md",
    "ego-browser/references/scripts.md",
    "ego-browser/references/spaces.md",
    "ego-browser/references/pages.md",
    "ego-browser/references/files.md",
    "agent-skills/ego-browser/SKILL.md",
  ]) {
    await readFile(join(payload, entry));
  }
  const id = `${Date.now()}-${process.pid}`;
  const entries = [
    { target: p.debug, source: payload },
    { target: p.skill, source: join(payload, "agent-skills/ego-browser") },
  ];
  const completed = [];
  try {
    for (const entry of entries) {
      await mkdir(dirname(entry.target), { recursive: true });
      const backup = (await exists(entry.target))
        ? `${entry.target}.backup-${id}`
        : null;
      if (backup) await rename(entry.target, backup);
      completed.push({ ...entry, backup });
      await cp(entry.source, entry.target, { recursive: true });
      await writeFile(
        join(entry.target, ".token-efficient-overlay.json"),
        JSON.stringify({ owner, id }),
      );
    }
    await mkdir(dirname(p.state), { recursive: true });
    await writeFile(
      p.state,
      JSON.stringify({ owner, id, entries: completed }, null, 2),
    );
  } catch (error) {
    // Preserve even a partial copy, then restore both originals. Never remove a
    // pre-existing user's directory or follow a Skill symlink while replacing it.
    for (const entry of completed.reverse()) {
      if (await exists(entry.target))
        await rename(entry.target, `${entry.target}.failed-${id}`);
      if (entry.backup) await rename(entry.backup, entry.target);
    }
    throw error;
  }
  return {
    installed: true,
    sdk: join(p.debug, "index.js"),
    skill: p.skill,
    backups: completed.map((entry) => entry.backup).filter(Boolean),
  };
}

export async function uninstallLocalSdk({ home = homedir() } = {}) {
  const p = paths(home);
  const state = JSON.parse(await readFile(p.state, "utf8"));
  const targets = [p.debug, p.skill];
  if (
    state.owner !== owner ||
    !state.id ||
    state.entries?.length !== 2 ||
    state.entries.some(
      (entry, i) =>
        entry.target !== targets[i] ||
        (entry.backup !== null &&
          entry.backup !== `${entry.target}.backup-${state.id}`),
    )
  ) {
    throw new Error(
      "Unexpected overlay manifest; refusing to change the installation.",
    );
  }
  // Check ownership of BOTH destinations before restoring either one.
  for (const entry of state.entries) {
    const marker = JSON.parse(
      await readFile(
        join(entry.target, ".token-efficient-overlay.json"),
        "utf8",
      ),
    );
    if (marker.owner !== owner || marker.id !== state.id)
      throw new Error(
        `Overlay changed at ${entry.target}; refusing to overwrite it.`,
      );
  }
  const preserved = [];
  for (const entry of state.entries) {
    const saved = `${entry.target}.removed-${Date.now()}-${process.pid}`;
    await rename(entry.target, saved);
    preserved.push(saved);
    if (entry.backup) await rename(entry.backup, entry.target);
  }
  await rename(p.state, `${p.state}.removed-${Date.now()}`);
  return { restored: true, preserved };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  if (process.platform !== "darwin")
    throw new Error(
      "Automatic overlay installation supports macOS only. Use --sdk-path on other platforms; see docs/token-efficient-install.md.",
    );
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--uninstall"))
    throw new Error("Usage: node scripts/install-local-sdk.mjs [--uninstall]");
  console.log(
    JSON.stringify(
      args[0] === "--uninstall"
        ? await uninstallLocalSdk()
        : await installLocalSdk(),
      null,
      2,
    ),
  );
}
