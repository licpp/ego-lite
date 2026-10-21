import { createHash } from "node:crypto";

const MAX_LINES = 20_000;
export type SnapshotBaseline = { key: string; lines: string[] };

export function validateSnapshotBaseline(value: unknown): SnapshotBaseline {
  const baseline = value as SnapshotBaseline;
  if (
    !baseline ||
    typeof baseline.key !== "string" ||
    !/^[a-f0-9]{32}$/.test(baseline.key) ||
    !Array.isArray(baseline.lines) ||
    baseline.lines.length > MAX_LINES ||
    baseline.lines.some(
      (line) => typeof line !== "string" || !/^[a-f0-9]{32}$/.test(line),
    )
  )
    throw new Error("invalid snapshot baseline");
  return { key: baseline.key, lines: [...baseline.lines] };
}

export function snapshotDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Store only hashes, never previous page text. Context makes repeated labels distinct. */
export function diffSnapshot(
  content: string,
  key: string,
  previous?: SnapshotBaseline,
): {
  body: string;
  baseline?: SnapshotBaseline;
} {
  const lines = content === "" ? [] : content.split("\n");
  if (lines.length > MAX_LINES)
    return {
      body: `[ego-browser:snapshot] full: too many lines for a diff baseline; narrow scope.\n${content}`,
    };
  const parents: number[] = [];
  const parentIndices: (number | undefined)[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const indent = lines[i].search(/\S/);
    while (parents.length && lines[parents.at(-1)!].search(/\S/) >= indent)
      parents.pop();
    parentIndices.push(parents.at(-1));
    hashes.push(
      snapshotDigest(
        `${parents.length ? hashes[parents.at(-1)!] : ""}\n${lines[i]}`,
      ),
    );
    parents.push(i);
  }
  const baseline = { key: snapshotDigest(key), lines: hashes };
  if (!previous || previous.key !== baseline.key)
    return {
      body: `[ego-browser:snapshot] full: new diff baseline.\n${content}`,
      baseline,
    };
  // Occurrence suffixes retain duplicate counts without persisting page text.
  const occurrences = (values: string[]) => {
    const counts = new Map<string, number>();
    return values.map((value) => {
      const count = (counts.get(value) ?? 0) + 1;
      counts.set(value, count);
      return `${value}:${count}`;
    });
  };
  const old = occurrences(previous.lines);
  const current = occurrences(hashes);
  const oldSet = new Set(old);
  const currentSet = new Set(current);
  const removed = old.filter((line) => !currentSet.has(line)).length;
  const changed = current.flatMap((line, i) => (oldSet.has(line) ? [] : [i]));
  const oldCommon = old.filter((line) => currentSet.has(line));
  const currentCommon = current.filter((line) => oldSet.has(line));
  if (oldCommon.some((line, i) => line !== currentCommon[i]))
    return {
      body: `[ego-browser:snapshot] full: observed order changed.\n${content}`,
      baseline,
    };
  if (!changed.length && !removed)
    return {
      body: "[ego-browser:snapshot] no changes in observed scope.",
      baseline,
    };
  const selected = new Set<number>();
  for (const index of changed) {
    let ancestor = parentIndices[index];
    while (ancestor !== undefined && !selected.has(ancestor)) {
      selected.add(ancestor);
      ancestor = parentIndices[ancestor];
    }
    selected.add(index);
  }
  const body = [...selected]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join("\n");
  return {
    body: `[ego-browser:snapshot] diff: ${changed.length} added/changed lines; ${removed} previous lines no longer observed (not proof of DOM deletion). Unchanged ancestors included; omitted lines are unchanged.\n${body}`,
    baseline,
  };
}
