/** Bound returned text without cutting a ref/locator line in half. */
export function limitSnapshotBody(content: string, maxChars?: number): string {
  if (maxChars === undefined || content.length <= maxChars) return content;
  const boundary = content.lastIndexOf("\n", maxChars);
  const visible = boundary < 0 ? "" : content.slice(0, boundary);
  return `${visible}${visible ? "\n" : ""}[ego-browser:snapshot] truncated: ${visible.length}/${content.length} body characters shown. Omitted content may contain more controls; narrow scope/use a bounded DOM extraction, or increase maxChars.`;
}
