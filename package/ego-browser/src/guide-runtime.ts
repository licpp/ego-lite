import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { bufferOutput } from "./output-sink.js";

const topics = ["scripts", "spaces", "pages", "files"] as const;

/** Read only a requested topic from the guide shipped with this SDK. */
export async function readGuide(topic?: string): Promise<string> {
  if (topic === undefined) {
    return `Guide topics: ${topics.join(", ")}. Use await guide("topic") for one reference; help("page.method") for an API signature.`;
  }
  if (!topics.includes(topic as (typeof topics)[number])) {
    throw new TypeError(
      `Unknown guide topic: ${String(topic)}. Choose ${topics.join(", ")}.`,
    );
  }
  const adjacent = new URL("./ego-browser/", import.meta.url);
  // dist/out/index.js uses the adjacent payload; dist/src modules use source
  // references for unit tests. Never fall back to an unrelated installed Skill.
  const root = existsSync(fileURLToPath(adjacent))
    ? adjacent
    : new URL("../../skill-body/", import.meta.url);
  return readFile(new URL(`references/${topic}.md`, root), "utf8");
}

/** Print one on-demand usage reference without observing a browser Page. */
export async function guide(topic?: string): Promise<string> {
  const text = await readGuide(topic);
  bufferOutput(`${text}\n`);
  return text;
}
